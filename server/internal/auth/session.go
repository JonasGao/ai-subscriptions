package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"ai-subscriptions/internal/model"
)

// SessionTTL matches NextAuth's 7-day JWT maxAge in lib/auth.config.ts.
const SessionTTL = 7 * 24 * time.Hour

// Claims is the stateless session payload. The token is signed with
// HMAC-SHA256(secret) and lives entirely in the cookie, so it survives process
// restarts. Fingerprint binds the token to the current password hash: changing
// the password invalidates every previously issued session.
type Claims struct {
	Username    string `json:"u"`
	IsInitial   bool   `json:"i"`
	ExpiresAt   int64  `json:"exp"`
	Fingerprint string `json:"fp"`
}

// User is an authenticated caller's identity.
type User struct {
	Username  string
	IsInitial bool
}

// Fingerprint derives the non-reversible credential binding stored in tokens.
// It is sha256(passwordHash), truncated to 16 hex characters.
func Fingerprint(passwordHash string) string {
	sum := sha256.Sum256([]byte(passwordHash))
	return hex.EncodeToString(sum[:8])
}

func (s *Service) issue(data *model.AuthData, now time.Time) (string, error) {
	claims := Claims{
		Username:    data.Username,
		IsInitial:   data.IsInitial,
		ExpiresAt:   now.Add(SessionTTL).Unix(),
		Fingerprint: Fingerprint(data.PasswordHash),
	}
	return s.sign(claims)
}

func (s *Service) sign(claims Claims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return encoded + "." + base64.RawURLEncoding.EncodeToString(s.mac(encoded)), nil
}

func (s *Service) mac(payload string) []byte {
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(payload))
	return h.Sum(nil)
}

// Verify validates a cookie token and returns the caller identity. It rejects
// malformed/tampered tokens, expired tokens, sessions from another secret and
// sessions bound to a password that has since changed.
func (s *Service) Verify(token string) (User, bool) {
	payload, signature, ok := strings.Cut(token, ".")
	if !ok || payload == "" || signature == "" {
		return User{}, false
	}

	gotSignature, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || !hmac.Equal(gotSignature, s.mac(payload)) {
		return User{}, false
	}

	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return User{}, false
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return User{}, false
	}
	if s.now().Unix() > claims.ExpiresAt {
		return User{}, false
	}

	data, err := s.store.AuthData()
	if err != nil || data == nil {
		return User{}, false
	}
	if data.Username != claims.Username || Fingerprint(data.PasswordHash) != claims.Fingerprint {
		return User{}, false
	}
	return User{Username: claims.Username, IsInitial: claims.IsInitial}, true
}
