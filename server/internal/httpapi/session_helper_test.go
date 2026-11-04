package httpapi

import (
	"net/http"
	"path/filepath"
	"testing"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/store"
)

// newSessionRouter builds a router whose session gate is backed by a real auth
// service on a temporary store, and signs in so the returned cookie passes the
// gate. Tests about non-auth behaviour use it to reach their route.
func newSessionRouter(t *testing.T, opts Options) (http.Handler, *http.Cookie) {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	svc := auth.New(db, "route-test-secret")
	result, err := svc.Authenticate(auth.SeedUsername, auth.SeedPassword, "203.0.113.30")
	if err != nil {
		t.Fatalf("seed login: %v", err)
	}

	if opts.Auth == nil {
		opts.Auth = svc
	}
	return New(opts), &http.Cookie{Name: authCookieName, Value: result.Token}
}
