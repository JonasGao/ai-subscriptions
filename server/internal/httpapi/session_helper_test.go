package httpapi

import (
	"net/http"
	"path/filepath"
	"testing"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/store"
)

// newSessionRouterWithStore builds a router whose session gate is backed by a
// real auth service on a temporary store, and signs in so the returned cookie
// passes the gate. The store is also wired as the data service so tests can
// seed and inspect subscription state.
func newSessionRouterWithStore(t *testing.T, opts Options) (http.Handler, *http.Cookie, *store.Store) {
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
	if opts.Data == nil {
		opts.Data = db
	}
	if opts.ProviderRefs == nil {
		opts.ProviderRefs = db
	}
	if opts.Priorities == nil {
		opts.Priorities = db
	}
	if opts.Tools == nil {
		opts.Tools = db
	}
	if opts.Cipher == nil {
		opts.Cipher = crypto.New("route-test-secret")
	}
	return New(opts), &http.Cookie{Name: authCookieName, Value: result.Token}, db
}

// newSessionRouter is the store-less flavour used by tests that only care
// about routing and auth.
func newSessionRouter(t *testing.T, opts Options) (http.Handler, *http.Cookie) {
	t.Helper()
	srv, cookie, _ := newSessionRouterWithStore(t, opts)
	return srv, cookie
}

// newSubscriptionRouter is the subscription-route flavour: it returns the
// store so tests can seed and inspect state.
func newSubscriptionRouter(t *testing.T) (http.Handler, *http.Cookie, *store.Store) {
	t.Helper()
	return newSessionRouterWithStore(t, Options{})
}
