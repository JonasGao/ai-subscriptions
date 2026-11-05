package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/store"
)

// Port of __tests__/models-route.test.ts (3 cases) plus the route shapes of the
// usage/balance handlers that the old stack had no tests for.
//
// Deviation: the old tests mocked lib/db and lib/encryption; here the routes run
// against a real SQLite store and a real cipher, and the outbound provider call
// goes through an injected HTTPDoer (Options.ProviderHTTP).

// stubProviderHTTP records outbound requests and replies with a canned body.
type stubProviderHTTP struct {
	statusCode int
	body       string
	requests   []*http.Request
	// err, when set, is returned instead of a response (transport failure).
	err error
}

func (s *stubProviderHTTP) Do(req *http.Request) (*http.Response, error) {
	s.requests = append(s.requests, req)
	if s.err != nil {
		return nil, s.err
	}
	status := s.statusCode
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Body:       io.NopCloser(strings.NewReader(s.body)),
		Header:     make(http.Header),
	}, nil
}

// subscriptionQueryFixture builds a router with a stubbed provider client and
// returns the pieces a query test needs.
type subscriptionQueryFixture struct {
	srv    http.Handler
	cookie *http.Cookie
	db     *store.Store
	client *stubProviderHTTP
	cipher *crypto.Cipher
}

func newSubscriptionQueryFixture(t *testing.T, body string) subscriptionQueryFixture {
	t.Helper()
	client := &stubProviderHTTP{body: body}
	cipher := crypto.New("route-test-secret")
	srv, cookie, db := newSessionRouterWithStore(t, Options{ProviderHTTP: client, Cipher: cipher})
	return subscriptionQueryFixture{srv: srv, cookie: cookie, db: db, client: client, cipher: cipher}
}

// seedEncryptedCredential stores creds as the ciphertext the routes decrypt.
func (f subscriptionQueryFixture) encrypt(t *testing.T, creds map[string]string) string {
	t.Helper()
	value, err := f.cipher.EncryptCredentials(creds)
	if err != nil {
		t.Fatalf("encrypt credentials: %v", err)
	}
	return value
}
