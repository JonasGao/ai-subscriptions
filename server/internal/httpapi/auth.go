package httpapi

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"ai-subscriptions/internal/auth"
)

// AuthService is the authentication seam the router depends on. *auth.Service
// is the production implementation; tests substitute narrower stubs.
type AuthService interface {
	Authenticate(username, password, clientIP string) (auth.LoginResult, error)
	ChangePassword(oldPassword, newPassword string) (auth.LoginResult, error)
	IsInitial() (bool, error)
	Verify(token string) (auth.User, bool)
}

// authCookieName is the self-issued session cookie (ADR-0018 replaces the
// NextAuth JWT with a stateless HMAC token).
const authCookieName = "ai_subscriptions_session"

// authWhitelisted lists the only API paths reachable without a session: the
// auth surface (login/logout/session/is-initial) plus the liveness probe.
// /api/health must stay public because the distroless container healthcheck
// (`ai-subscriptions healthcheck`) probes it without a cookie. change-password
// is deliberately NOT here — it requires an authenticated caller, exactly like
// the old stack's route handler.
var authWhitelisted = map[string]bool{
	"/api/health":          true,
	"/api/auth/login":      true,
	"/api/auth/logout":     true,
	"/api/auth/session":    true,
	"/api/auth/is-initial": true,
}

// sessionGate rejects every API request outside authWhitelisted that carries
// no valid session cookie (middleware matcher parity with the old stack's
// middleware.ts: everything except /api/auth is protected).
func (opts Options) sessionGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authWhitelisted[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := opts.currentUser(r); !ok {
			writeJSONAligned(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// currentUser verifies the session cookie with the auth service.
func (opts Options) currentUser(r *http.Request) (auth.User, bool) {
	if opts.Auth == nil {
		return auth.User{}, false
	}
	cookie, err := r.Cookie(authCookieName)
	if err != nil {
		return auth.User{}, false
	}
	return opts.Auth.Verify(cookie.Value)
}

type userPayload struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	IsInitial bool   `json:"isInitial"`
}

func newUserPayload(user auth.User) userPayload {
	return userPayload{
		ID:        "1",
		Username:  user.Username,
		Name:      user.Username,
		Email:     user.Username + "@local",
		IsInitial: user.IsInitial,
	}
}

// handleLogin serves POST /api/auth/login (ADR-0018 auth shape exception).
func handleLogin(svc AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		if body.Username == "" || body.Password == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "请填写完整"})
			return
		}

		result, err := svc.Authenticate(body.Username, body.Password, clientIP(r))
		switch {
		case errors.Is(err, auth.ErrRateLimited):
			writeJSONAligned(w, http.StatusTooManyRequests, map[string]string{"error": "尝试次数过多，请15分钟后再试"})
			return
		case errors.Is(err, auth.ErrInvalidCredentials):
			writeJSONAligned(w, http.StatusUnauthorized, map[string]string{"error": "用户名或密码错误"})
			return
		case err != nil:
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "登录失败"})
			return
		}

		setSessionCookie(w, r, result.Token)
		writeJSONAligned(w, http.StatusOK, map[string]any{
			"user": newUserPayload(auth.User{Username: result.Username, IsInitial: result.IsInitial}),
		})
	}
}

// handleLogout serves POST /api/auth/logout: only the cookie needs clearing.
// Unlike change-password it needs no session, so SameSite=Lax does not protect
// it — a cross-site form can force a logout by making the browser accept the
// clearing Set-Cookie. The old stack's NextAuth signout required a CSRF token;
// here the equivalent guarantee comes from rejecting cross-site origins.
func handleLogout(w http.ResponseWriter, r *http.Request) {
	if isCrossSiteRequest(r) {
		writeJSONAligned(w, http.StatusForbidden, map[string]string{"error": "跨站请求被拒绝"})
		return
	}
	clearSessionCookie(w, r)
	writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
}

// isCrossSiteRequest reports whether a state-changing request came from
// another origin. Origin is the authoritative browser signal; Sec-Fetch-Site
// covers browsers that omit it. Non-browser clients (curl, the healthcheck)
// send neither and are allowed — they cannot be CSRF'd.
func isCrossSiteRequest(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return true
	}
	return !strings.EqualFold(parsed.Host, r.Host)
}

// handleSession serves GET /api/auth/session. The unauthenticated body is an
// empty object (no user). The response must never be cached: the old stack's
// NextAuth session route sends Cache-Control/Pragma/Expires no-cache headers
// (@auth/core), and without them a browser or intermediary could replay one
// caller's session body to another or keep a stale logged-in view after logout.
func handleSession(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-cache, no-store")
		w.Header().Set("Expires", "0")
		w.Header().Set("Pragma", "no-cache")
		user, ok := opts.currentUser(r)
		if !ok {
			writeJSONAligned(w, http.StatusOK, map[string]any{})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]any{"user": newUserPayload(user)})
	}
}

// handleIsInitial serves GET /api/auth/is-initial (shape unchanged from the
// old stack's route).
func handleIsInitial(svc AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		isInitial, err := svc.IsInitial()
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "读取账号失败"})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"isInitial": isInitial})
	}
}

// handleChangePassword serves POST /api/auth/change-password (shape unchanged:
// {oldPassword,newPassword} → {success:true} / {error}). The token is bound to
// the password hash, so a successful change kills every session issued before
// it. The caller is the one exception the old stack kept signed in (non-forced
// flow lands on /subscriptions instead of re-authenticating), so it receives a
// replacement cookie minted against the new hash.
func handleChangePassword(svc AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OldPassword string `json:"oldPassword"`
			NewPassword string `json:"newPassword"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.OldPassword == "" || body.NewPassword == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "请填写完整"})
			return
		}

		result, err := svc.ChangePassword(body.OldPassword, body.NewPassword)
		switch {
		case errors.Is(err, auth.ErrPasswordTooShort), errors.Is(err, auth.ErrOldPassword):
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		case err != nil:
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "修改失败"})
			return
		}

		setSessionCookie(w, r, result.Token)
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecureRequest(r),
		MaxAge:   int(auth.SessionTTL / time.Second),
		Expires:  time.Now().Add(auth.SessionTTL),
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecureRequest(r),
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
}

func isSecureRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// clientIP keys the login limiter. The old stack used X-Forwarded-For, but
// the deployment publishes port 3000 directly, so that header is attacker
// controlled and would let a brute-force client mint a fresh bucket per
// request. The peer address keeps the 5-attempts/15-minutes guarantee (all
// clients behind one proxy share a bucket, which for this single-user app is
// the safe failure mode).
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown"
}
