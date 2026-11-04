package auth_test

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/store"
)

// testClock is a manually advanced clock so the 15-minute login window and
// the 7-day cookie lifetime can be exercised without sleeping.
type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func newTestClock() *testClock {
	return &testClock{now: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)}
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func newTestService(t *testing.T, db *store.Store, clock *testClock) *auth.Service {
	t.Helper()
	return auth.New(db, "test-session-secret", auth.WithClock(clock.Now))
}

func TestSeedAccountOnFirstUse(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	initial, err := svc.IsInitial()
	if err != nil {
		t.Fatalf("IsInitial: %v", err)
	}
	if !initial {
		t.Fatal("fresh install IsInitial = false, want true (forced password change)")
	}

	data, err := db.AuthData()
	if err != nil {
		t.Fatalf("AuthData: %v", err)
	}
	if data == nil {
		t.Fatal("seed account was not written")
	}
	if data.Username != "admin" {
		t.Errorf("username = %q, want admin", data.Username)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(data.PasswordHash), []byte("admin123")); err != nil {
		t.Errorf("seed password does not verify against admin123: %v", err)
	}
	if cost, err := bcrypt.Cost([]byte(data.PasswordHash)); err != nil || cost != 10 {
		t.Errorf("bcrypt cost = %d (err=%v), want 10 (lib/auth.ts hashSync(..., 10))", cost, err)
	}
	if data.CreatedAt == "" || data.UpdatedAt == "" {
		t.Errorf("seed timestamps empty: created=%q updated=%q", data.CreatedAt, data.UpdatedAt)
	}
}

func TestSeedAccountIsIdempotent(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	if _, err := svc.IsInitial(); err != nil {
		t.Fatalf("first IsInitial: %v", err)
	}
	first, err := db.AuthData()
	if err != nil || first == nil {
		t.Fatalf("AuthData after seed: %v", err)
	}

	if _, err := svc.IsInitial(); err != nil {
		t.Fatalf("second IsInitial: %v", err)
	}
	second, err := db.AuthData()
	if err != nil || second == nil {
		t.Fatalf("AuthData after second seed: %v", err)
	}
	if first.PasswordHash != second.PasswordHash {
		t.Error("re-seeding replaced the existing password hash")
	}
}

func TestAuthenticateAcceptsSeedCredentials(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	result, err := svc.Authenticate("admin", "admin123", "203.0.113.7")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if result.Username != "admin" || !result.IsInitial {
		t.Errorf("result = %+v, want admin with isInitial=true", result)
	}
	if result.Token == "" {
		t.Error("Authenticate returned an empty session token")
	}
}

func TestAuthenticateRejectsWrongCredentials(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	cases := []struct {
		name     string
		username string
		password string
	}{
		{"wrong password", "admin", "nope"},
		{"unknown user", "someone", "admin123"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.Authenticate(tc.username, tc.password, "203.0.113.8")
			if !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("err = %v, want ErrInvalidCredentials", err)
			}
		})
	}
}

func TestLoginLocksAfterFiveFailedAttempts(t *testing.T) {
	db := newTestStore(t)
	clock := newTestClock()
	svc := newTestService(t, db, clock)
	const ip = "198.51.100.1"

	for i := 1; i <= 5; i++ {
		if _, err := svc.Authenticate("admin", "wrong", ip); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("attempt %d err = %v, want ErrInvalidCredentials", i, err)
		}
	}

	// The sixth attempt is refused even with the correct password.
	if _, err := svc.Authenticate("admin", "admin123", ip); !errors.Is(err, auth.ErrRateLimited) {
		t.Fatalf("attempt 6 err = %v, want ErrRateLimited", err)
	}

	// Other addresses are unaffected.
	if _, err := svc.Authenticate("admin", "admin123", "198.51.100.2"); err != nil {
		t.Fatalf("another IP was locked out too: %v", err)
	}
}

func TestLoginLockExpiresAfterFifteenMinutes(t *testing.T) {
	db := newTestStore(t)
	clock := newTestClock()
	svc := newTestService(t, db, clock)
	const ip = "198.51.100.3"

	for i := 0; i < 5; i++ {
		_, _ = svc.Authenticate("admin", "wrong", ip)
	}
	if _, err := svc.Authenticate("admin", "admin123", ip); !errors.Is(err, auth.ErrRateLimited) {
		t.Fatalf("before window expiry err = %v, want ErrRateLimited", err)
	}

	clock.Advance(15*time.Minute + time.Second)
	if _, err := svc.Authenticate("admin", "admin123", ip); err != nil {
		t.Fatalf("after window expiry err = %v, want success", err)
	}
}

func TestSuccessfulLoginResetsFailureCounter(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())
	const ip = "198.51.100.4"

	for i := 0; i < 4; i++ {
		_, _ = svc.Authenticate("admin", "wrong", ip)
	}
	if _, err := svc.Authenticate("admin", "admin123", ip); err != nil {
		t.Fatalf("login after four failures: %v", err)
	}
	// A fresh five-attempt budget is available.
	for i := 0; i < 4; i++ {
		if _, err := svc.Authenticate("admin", "wrong", ip); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("post-reset attempt %d err = %v, want invalid credentials", i, err)
		}
	}
}

func TestChangePasswordValidatesInput(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	if _, err := svc.ChangePassword("admin123", "12345"); !errors.Is(err, auth.ErrPasswordTooShort) {
		t.Fatalf("short password err = %v, want ErrPasswordTooShort", err)
	}
	// The old stack checks the new-password length before the old password.
	if _, err := svc.ChangePassword("wrong-old", "12345"); !errors.Is(err, auth.ErrPasswordTooShort) {
		t.Fatalf("short password with wrong old err = %v, want ErrPasswordTooShort", err)
	}
	if _, err := svc.ChangePassword("wrong-old", "newpass123"); !errors.Is(err, auth.ErrOldPassword) {
		t.Fatalf("wrong old password err = %v, want ErrOldPassword", err)
	}
}

func TestChangePasswordSuccessClearsInitialFlag(t *testing.T) {
	db := newTestStore(t)
	clock := newTestClock()
	svc := newTestService(t, db, clock)

	// A page load (is-initial) seeds the account before the first change.
	if _, err := svc.IsInitial(); err != nil {
		t.Fatalf("IsInitial: %v", err)
	}
	before, err := db.AuthData()
	if err != nil || before == nil {
		t.Fatalf("AuthData before change: %v", err)
	}
	clock.Advance(time.Minute)
	if _, err := svc.ChangePassword("admin123", "newpass456"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}

	after, err := db.AuthData()
	if err != nil || after == nil {
		t.Fatalf("AuthData after change: %v", err)
	}
	if after.IsInitial {
		t.Error("isInitial stayed true after a successful password change")
	}
	if after.PasswordHash == before.PasswordHash {
		t.Error("password hash unchanged")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(after.PasswordHash), []byte("newpass456")); err != nil {
		t.Errorf("new password does not verify: %v", err)
	}
	if after.UpdatedAt == before.UpdatedAt {
		t.Errorf("updatedAt unchanged: %q", after.UpdatedAt)
	}

	initial, err := svc.IsInitial()
	if err != nil || initial {
		t.Errorf("IsInitial after change = %v (err=%v), want false", initial, err)
	}
}

func TestSessionTokenRoundTrip(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	result, err := svc.Authenticate("admin", "admin123", "203.0.113.9")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}

	user, ok := svc.Verify(result.Token)
	if !ok {
		t.Fatal("issued token did not verify")
	}
	if user.Username != "admin" || !user.IsInitial {
		t.Errorf("user = %+v, want admin with isInitial=true", user)
	}
}

func TestSessionTokenSurvivesRestart(t *testing.T) {
	db := newTestStore(t)
	first := newTestService(t, db, newTestClock())

	result, err := first.Authenticate("admin", "admin123", "203.0.113.10")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}

	// A new Service with the same secret and database models a process
	// restart: the stateless cookie keeps working.
	second := auth.New(db, "test-session-secret", auth.WithClock(newTestClock().Now))
	if _, ok := second.Verify(result.Token); !ok {
		t.Fatal("token stopped verifying after restart")
	}
}

func TestSessionTokenExpiresAfterSevenDays(t *testing.T) {
	db := newTestStore(t)
	clock := newTestClock()
	svc := newTestService(t, db, clock)

	result, err := svc.Authenticate("admin", "admin123", "203.0.113.11")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	clock.Advance(7 * 24 * time.Hour)
	if _, ok := svc.Verify(result.Token); !ok {
		t.Fatal("token expired exactly at 7 days")
	}
	clock.Advance(time.Second)
	if _, ok := svc.Verify(result.Token); ok {
		t.Fatal("token still valid after 7 days + 1s")
	}
}

// The old stack's non-forced flow keeps the user signed in after a password
// change (app/change-password/page.tsx only signs out when force=1), so the
// successful change must hand the caller a token bound to the NEW hash.
// Sessions issued before the change stay dead — only this one is replaced.
func TestChangePasswordReissuesSessionForCaller(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	before, err := svc.Authenticate("admin", "admin123", "203.0.113.14")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}

	after, err := svc.ChangePassword("admin123", "newpass900")
	if err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if after.Token == "" {
		t.Fatal("ChangePassword returned no replacement token")
	}

	user, ok := svc.Verify(after.Token)
	if !ok {
		t.Fatal("replacement token does not verify")
	}
	if user.Username != "admin" || user.IsInitial {
		t.Errorf("user = %+v, want admin with isInitial=false", user)
	}
	if _, ok := svc.Verify(before.Token); ok {
		t.Error("token issued before the change still verifies")
	}
}

func TestSessionTokenInvalidAfterPasswordChange(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	result, err := svc.Authenticate("admin", "admin123", "203.0.113.12")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if _, err := svc.ChangePassword("admin123", "newpass789"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if _, ok := svc.Verify(result.Token); ok {
		t.Fatal("session issued before the password change is still valid")
	}

	next, err := svc.Authenticate("admin", "newpass789", "203.0.113.12")
	if err != nil {
		t.Fatalf("login with new password: %v", err)
	}
	user, ok := svc.Verify(next.Token)
	if !ok {
		t.Fatal("session issued after the password change does not verify")
	}
	if user.IsInitial {
		t.Error("new session still reports isInitial=true")
	}
}

func TestSessionTokenRejectsTamperingAndForeignSecrets(t *testing.T) {
	db := newTestStore(t)
	svc := newTestService(t, db, newTestClock())

	result, err := svc.Authenticate("admin", "admin123", "203.0.113.13")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}

	tampered := result.Token[:len(result.Token)-1] + "X"
	if _, ok := svc.Verify(tampered); ok {
		t.Error("tampered token verified")
	}
	if _, ok := svc.Verify("not-a-token"); ok {
		t.Error("garbage token verified")
	}
	if _, ok := svc.Verify(""); ok {
		t.Error("empty token verified")
	}

	foreign := auth.New(db, "another-secret", auth.WithClock(newTestClock().Now))
	if _, ok := foreign.Verify(result.Token); ok {
		t.Error("token signed with a different secret verified")
	}
}

func TestSecretFromEnv(t *testing.T) {
	if secret, generated := auth.SecretFromEnv(func(string) string { return "configured" }); secret != "configured" || generated {
		t.Errorf("configured secret = %q generated=%v, want passthrough", secret, generated)
	}
	secret, generated := auth.SecretFromEnv(func(string) string { return "" })
	if !generated {
		t.Error("missing NEXTAUTH_SECRET did not report a generated secret")
	}
	if len(secret) != 64 {
		t.Errorf("generated secret length = %d, want 64 hex chars", len(secret))
	}
}
