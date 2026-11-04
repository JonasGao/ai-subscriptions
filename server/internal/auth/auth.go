// Package auth implements the old stack's authentication semantics without
// NextAuth: a seeded admin account with an isInitial flag, forced password
// change, bcrypt hashing (cost 10, lib/auth.ts), a per-IP login rate limiter
// (5 attempts / 15 minutes) and a stateless HMAC-signed session cookie that
// survives process restarts (ADR-0018).
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

// Seed credentials match lib/auth.ts's first-run document.
const (
	// SeedUsername is the account name created on first start.
	SeedUsername = "admin"
	// SeedPassword is the initial password; isInitial forces a change.
	SeedPassword = "admin123"
	// MinPasswordLength mirrors the old stack's "密码长度至少6位" rule.
	MinPasswordLength = 6
	// bcryptCost matches bcrypt.hashSync(password, 10).
	bcryptCost = 10
)

// Sentinel errors mapped to HTTP status codes by the API layer.
var (
	// ErrInvalidCredentials means the username/password pair did not match.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrRateLimited means the IP exceeded its login attempt budget.
	ErrRateLimited = errors.New("too many login attempts")
	// ErrOldPassword means the supplied current password was wrong.
	ErrOldPassword = errors.New("原密码错误")
	// ErrPasswordTooShort means the new password is shorter than 6 characters.
	ErrPasswordTooShort = errors.New("密码长度至少6位")
)

// Store is the persistence seam the service needs (satisfied by *store.Store).
type Store interface {
	AuthData() (*model.AuthData, error)
	WriteAuthData(*model.AuthData) error
}

// Service owns credential verification, password change and session tokens.
type Service struct {
	store     Store
	secret    []byte
	now       func() time.Time
	rateLimit *RateLimiter
	// mu serialises account read-modify-write (seed and password change) so
	// two concurrent first requests cannot both write a seed document.
	mu sync.Mutex
}

// Option customises New.
type Option func(*Service)

// WithClock replaces the time source (tests drive the 15-minute login window
// and the 7-day cookie lifetime with a fake clock).
func WithClock(now func() time.Time) Option {
	return func(s *Service) { s.now = now }
}

// New returns a Service bound to store and signing secret.
func New(store Store, secret string, opts ...Option) *Service {
	s := &Service{
		store:     store,
		secret:    []byte(secret),
		now:       time.Now,
		rateLimit: NewRateLimiter(),
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// SecretFromEnv resolves the session signing secret from NEXTAUTH_SECRET,
// mirroring the old stack: an unset variable warns and falls back to a random
// secret, which invalidates sessions on restart (ADR-0018 keeps the variable
// name and the dev fallback).
func SecretFromEnv(getenv func(string) string) (secret string, generated bool) {
	if value := getenv("NEXTAUTH_SECRET"); value != "" {
		return value, false
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// rand.Read only fails on a broken platform entropy source; the seed
		// time still yields a usable secret.
		return hex.EncodeToString([]byte(time.Now().String())), true
	}
	return hex.EncodeToString(buf), true
}

// ensureAccount seeds the admin account on first use, exactly once.
func (s *Service) ensureAccount() (*model.AuthData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ensureAccountLocked()
}

func (s *Service) ensureAccountLocked() (*model.AuthData, error) {
	data, err := s.store.AuthData()
	if err != nil {
		return nil, err
	}
	if data != nil {
		return data, nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(SeedPassword), bcryptCost)
	if err != nil {
		return nil, err
	}
	now := model.FormatTimestamp(s.now())
	seed := &model.AuthData{
		Username:     SeedUsername,
		PasswordHash: string(hash),
		CreatedAt:    now,
		UpdatedAt:    now,
		IsInitial:    true,
	}
	if err := s.store.WriteAuthData(seed); err != nil {
		return nil, err
	}
	return seed, nil
}

// IsInitial reports whether the account still uses the seed password.
func (s *Service) IsInitial() (bool, error) {
	data, err := s.ensureAccount()
	if err != nil {
		return false, err
	}
	return data.IsInitial, nil
}

// LoginResult is the outcome of a successful login.
type LoginResult struct {
	// Username is the authenticated account name.
	Username string
	// IsInitial reports whether the password still needs to be changed.
	IsInitial bool
	// Token is the signed session cookie value.
	Token string
}

// Authenticate verifies credentials for clientIP and, on success, issues a
// session token. Attempts are counted per IP before verification (like
// lib/auth.ts), so the fifth wrong password locks the address for 15 minutes.
func (s *Service) Authenticate(username, password, clientIP string) (LoginResult, error) {
	if !s.rateLimit.Allow(clientIP, s.now()) {
		return LoginResult{}, ErrRateLimited
	}

	data, err := s.ensureAccount()
	if err != nil {
		return LoginResult{}, err
	}
	if username != data.Username {
		return LoginResult{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(data.PasswordHash), []byte(password)); err != nil {
		return LoginResult{}, ErrInvalidCredentials
	}

	s.rateLimit.Reset(clientIP)

	token, err := s.issue(data, s.now())
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Username: data.Username, IsInitial: data.IsInitial, Token: token}, nil
}

// ChangePassword sets a new password after verifying the current one. The
// isInitial flag is cleared, and sessions issued before the change stop
// verifying because the token is bound to the password hash.
func (s *Service) ChangePassword(oldPassword, newPassword string) error {
	// utf8.RuneCountInString approximates JavaScript's String#length (UTF-16
	// code units) closely enough for the "至少6位" rule.
	if utf8.RuneCountInString(newPassword) < MinPasswordLength {
		return ErrPasswordTooShort
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.ensureAccountLocked()
	if err != nil {
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(data.PasswordHash), []byte(oldPassword)); err != nil {
		return ErrOldPassword
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcryptCost)
	if err != nil {
		return err
	}
	data.PasswordHash = string(hash)
	data.UpdatedAt = model.FormatTimestamp(s.now())
	data.IsInitial = false
	return s.store.WriteAuthData(data)
}

var _ Store = (*store.Store)(nil)
