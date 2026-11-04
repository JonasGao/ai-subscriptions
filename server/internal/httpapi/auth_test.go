package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/store"
)

type authFixture struct {
	handler http.Handler
	service *auth.Service
	store   *store.Store
}

// newAuthFixture builds the router around a real (temporary) SQLite store and
// a fake clock, so the login flow, session cookie and password change are
// exercised end to end through the public HTTP surface.
func newAuthFixture(t *testing.T) authFixture {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	svc := auth.New(db, "handler-test-secret", auth.WithClock(func() time.Time { return now }))
	return authFixture{
		handler: New(Options{Auth: svc}),
		service: svc,
		store:   db,
	}
}

func postJSON(t *testing.T, handler http.Handler, path string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "203.0.113.20:1234"
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func getWithCookie(t *testing.T, handler http.Handler, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.RemoteAddr = "203.0.113.20:1234"
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not a JSON object: %v (body=%q)", err, rec.Body.String())
	}
	return body
}

func sessionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == authCookieName {
			return cookie
		}
	}
	t.Fatalf("login response set no %s cookie (headers=%v)", authCookieName, rec.Result().Header)
	return nil
}

func TestIsInitialEndpointReportsSeedState(t *testing.T) {
	f := newAuthFixture(t)

	rec := getWithCookie(t, f.handler, "/api/auth/is-initial")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["isInitial"] != true {
		t.Errorf(`isInitial = %v, want true on a fresh install`, body["isInitial"])
	}
}

func TestIsInitialEndpointIsPublic(t *testing.T) {
	f := newAuthFixture(t)

	// No cookie: the login page must be able to read the flag.
	rec := getWithCookie(t, f.handler, "/api/auth/is-initial")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 without a session", rec.Code)
	}
}

func TestLoginSetsSessionCookieAndReportsInitialFlag(t *testing.T) {
	f := newAuthFixture(t)

	rec := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	body := decodeJSON(t, rec)
	user, ok := body["user"].(map[string]any)
	if !ok {
		t.Fatalf("body has no user object: %v", body)
	}
	if user["username"] != "admin" {
		t.Errorf("user.username = %v, want admin", user["username"])
	}
	if user["isInitial"] != true {
		t.Errorf("user.isInitial = %v, want true before the forced change", user["isInitial"])
	}

	cookie := sessionCookie(t, rec)
	if !cookie.HttpOnly {
		t.Error("session cookie is not HttpOnly")
	}
	if cookie.Path != "/" {
		t.Errorf("cookie Path = %q, want /", cookie.Path)
	}
	if want := int(auth.SessionTTL / time.Second); cookie.MaxAge != want {
		t.Errorf("cookie MaxAge = %d, want %d (7 days)", cookie.MaxAge, want)
	}
}

func TestLoginRejectsBadCredentials(t *testing.T) {
	f := newAuthFixture(t)

	rec := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "wrong",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["error"] != "用户名或密码错误" {
		t.Errorf("error = %v, want 用户名或密码错误", body["error"])
	}
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == authCookieName && cookie.Value != "" {
			t.Error("failed login still issued a session cookie")
		}
	}
}

func TestLoginBadRequestWithoutCredentials(t *testing.T) {
	f := newAuthFixture(t)

	rec := postJSON(t, f.handler, "/api/auth/login", map[string]string{"username": "admin"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestLoginRateLimitLocksAfterFiveFailures(t *testing.T) {
	f := newAuthFixture(t)

	for i := 0; i < 5; i++ {
		rec := postJSON(t, f.handler, "/api/auth/login", map[string]string{
			"username": "admin", "password": "wrong",
		})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401", i+1, rec.Code)
		}
	}

	rec := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("locked attempt status = %d, want 429 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); !strings.Contains(body["error"].(string), "15") {
		t.Errorf("error = %v, want it to mention the 15-minute window", body["error"])
	}
}

func TestSessionEndpointReturnsUserForValidCookie(t *testing.T) {
	f := newAuthFixture(t)

	login := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})
	cookie := sessionCookie(t, login)

	rec := getWithCookie(t, f.handler, "/api/auth/session", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	user, ok := decodeJSON(t, rec)["user"].(map[string]any)
	if !ok {
		t.Fatalf("body has no user object: %q", rec.Body.String())
	}
	if user["username"] != "admin" || user["isInitial"] != true {
		t.Errorf("user = %v, want admin/isInitial=true", user)
	}
}

func TestSessionEndpointWithoutCookieIsEmptyAndAnonymous(t *testing.T) {
	f := newAuthFixture(t)

	rec := getWithCookie(t, f.handler, "/api/auth/session")
	// The container healthcheck probes this endpoint, so it must answer 200
	// when nobody is logged in — but with no user attached.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["user"] != nil {
		t.Errorf("anonymous session body = %v, want no user", body)
	}
}

func TestLogoutClearsSessionCookie(t *testing.T) {
	f := newAuthFixture(t)

	login := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})
	cookie := sessionCookie(t, login)

	rec := postJSON(t, f.handler, "/api/auth/logout", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}

	var cleared *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == authCookieName {
			cleared = c
		}
	}
	if cleared == nil {
		t.Fatal("logout did not send a clearing cookie")
	}
	if cleared.Value != "" || cleared.MaxAge >= 0 {
		t.Errorf("clearing cookie = %+v, want empty value with negative MaxAge", cleared)
	}
}

func TestChangePasswordIsGatedAndUpdatesTheSessionState(t *testing.T) {
	f := newAuthFixture(t)

	if rec := postJSON(t, f.handler, "/api/auth/change-password", map[string]string{
		"oldPassword": "admin123", "newPassword": "newpass123",
	}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous change status = %d, want 401 (body=%q)", rec.Code, rec.Body.String())
	} else if body := decodeJSON(t, rec); body["error"] != "未登录" {
		t.Errorf("error = %v, want 未登录", body["error"])
	}

	login := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})
	cookie := sessionCookie(t, login)

	rec := postJSON(t, f.handler, "/api/auth/change-password", map[string]string{
		"oldPassword": "admin123", "newPassword": "12345",
	}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("short password status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["error"] != "密码长度至少6位" {
		t.Errorf("error = %v, want 密码长度至少6位", body["error"])
	}

	rec = postJSON(t, f.handler, "/api/auth/change-password", map[string]string{
		"oldPassword": "wrong", "newPassword": "newpass123",
	}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("wrong old password status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["error"] != "原密码错误" {
		t.Errorf("error = %v, want 原密码错误", body["error"])
	}

	rec = postJSON(t, f.handler, "/api/auth/change-password", map[string]string{
		"oldPassword": "admin123", "newPassword": "newpass123",
	}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("change status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["success"] != true {
		t.Errorf("success = %v, want true", body["success"])
	}

	// The pre-change cookie is dead and the flag is cleared.
	if rec := getWithCookie(t, f.handler, "/api/auth/session", cookie); rec.Code != http.StatusOK {
		t.Fatalf("session status = %d, want 200", rec.Code)
	} else if body := decodeJSON(t, rec); body["user"] != nil {
		t.Errorf("old session still authenticated after the password change: %v", body["user"])
	}
	if rec := getWithCookie(t, f.handler, "/api/auth/is-initial"); decodeJSON(t, rec)["isInitial"] != false {
		t.Error("isInitial stayed true after a successful change")
	}
}

func TestChangePasswordRequiresBothFields(t *testing.T) {
	f := newAuthFixture(t)

	login := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})
	cookie := sessionCookie(t, login)

	rec := postJSON(t, f.handler, "/api/auth/change-password", map[string]string{
		"oldPassword": "admin123",
	}, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if body := decodeJSON(t, rec); body["error"] != "请填写完整" {
		t.Errorf("error = %v, want 请填写完整", body["error"])
	}
}

func TestAPIRequiresSessionOutsideTheAuthWhitelist(t *testing.T) {
	f := newAuthFixture(t)

	protected := []struct{ method, path string }{
		{http.MethodGet, "/api/providers"},
		{http.MethodGet, "/api/providers/unregistered"},
		{http.MethodGet, "/api/subscriptions"},
		{http.MethodGet, "/api/tools"},
		{http.MethodGet, "/api/tags"},
		{http.MethodGet, "/api/notifications"},
		{http.MethodPost, "/api/subscriptions"},
		{http.MethodDelete, "/api/subscriptions/abc"},
	}
	for _, route := range protected {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			req.RemoteAddr = "203.0.113.21:1234"
			rec := httptest.NewRecorder()
			f.handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401 (body=%q)", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want JSON", ct)
			}
			if body := decodeJSON(t, rec); body["error"] != "未登录" {
				t.Errorf("error = %v, want 未登录", body["error"])
			}
		})
	}
}

func TestAPIAllowsWhitelistedPathsWithoutSession(t *testing.T) {
	f := newAuthFixture(t)

	for _, path := range []string{
		"/api/auth/login",
		"/api/auth/logout",
		"/api/auth/session",
		"/api/auth/is-initial",
		"/api/health",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "203.0.113.22:1234"
		rec := httptest.NewRecorder()
		f.handler.ServeHTTP(rec, req)

		if rec.Code == http.StatusUnauthorized {
			t.Errorf("GET %s is behind the session gate, want whitelisted", path)
		}
	}
}

func TestAPIAllowsRequestsWithASessionCookie(t *testing.T) {
	f := newAuthFixture(t)

	login := postJSON(t, f.handler, "/api/auth/login", map[string]string{
		"username": "admin", "password": "admin123",
	})
	cookie := sessionCookie(t, login)

	rec := getWithCookie(t, f.handler, "/api/providers", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
}
