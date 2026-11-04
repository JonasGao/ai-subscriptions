package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// The old stack exposed two credential-test APIs:
//   POST /api/test-connection               (form create/edit)
//   POST /api/subscriptions/{id}/test-connection (stored subscription)
// Both dispatch plan-aware usage handlers first, then balance handlers, and
// report an unsupported provider as a 400. These tests pin the routes and the
// response shape the new SubscriptionForm consumes.

func decodeConnectionResult(t *testing.T, raw []byte) (ok bool, message string) {
	t.Helper()
	var body struct {
		OK      bool   `json:"ok"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal connection result: %v (body=%q)", err, raw)
	}
	return body.OK, body.Message
}

func TestTestConnectionRoute(t *testing.T) {
	t.Run("dispatches to the plan-aware usage handler", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"moonshot","planId":"kimi-code","credentials":{"apiKey":"kimi-key"}}`,
			f.cookie,
		)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		ok, message := decodeConnectionResult(t, rec.Body.Bytes())
		if !ok || message != "连接成功" {
			t.Errorf("result = (%v, %q), want (true, 连接成功)", ok, message)
		}
		if len(f.client.requests) != 1 {
			t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
		}
		if got := f.client.requests[0].URL.String(); got != "https://api.moonshot.cn/v1/users/me/balance" {
			t.Errorf("request URL = %q", got)
		}
		if got := f.client.requests[0].Header.Get("Authorization"); got != "Bearer kimi-key" {
			t.Errorf("Authorization = %q, want Bearer kimi-key", got)
		}
	})

	t.Run("falls back to the provider balance handler", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"deepseek","credentials":{"apiKey":"ds-key"}}`,
			f.cookie,
		)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		if ok, _ := decodeConnectionResult(t, rec.Body.Bytes()); !ok {
			t.Error("ok = false, want true")
		}
		if got := f.client.requests[0].URL.String(); got != "https://api.deepseek.com/user/balance" {
			t.Errorf("request URL = %q", got)
		}
	})

	t.Run("reports an upstream rejection as ok false", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		f.client.statusCode = http.StatusUnauthorized
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"deepseek","credentials":{"apiKey":"bad"}}`,
			f.cookie,
		)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		ok, message := decodeConnectionResult(t, rec.Body.Bytes())
		if ok || message != "API 返回 401" {
			t.Errorf("result = (%v, %q), want (false, API 返回 401)", ok, message)
		}
	})

	t.Run("requires a provider", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"credentials":{"apiKey":"x"}}`, f.cookie,
		)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Provider is required") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})

	t.Run("requires credentials", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"deepseek","credentials":{}}`, f.cookie,
		)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Credentials are required") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})

	t.Run("reports unsupported providers", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"anthropic","credentials":{"apiKey":"x"}}`, f.cookie,
		)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Test connection not supported for anthropic") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})
}

func TestSubscriptionTestConnectionRoute(t *testing.T) {
	t.Run("uses the stored subscription's provider and plan", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "moonshot",
			PlanID:           "kimi-code",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
		})

		// The body carries credentials only; provider/planId come from the row.
		rec := request(t, f.srv, http.MethodPost,
			"/api/subscriptions/"+id+"/test-connection",
			`{"credentials":{"apiKey":"kimi-key"}}`, f.cookie,
		)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		if ok, message := decodeConnectionResult(t, rec.Body.Bytes()); !ok || message != "连接成功" {
			t.Errorf("result = (%v, %q), want (true, 连接成功)", ok, message)
		}
		if got := f.client.requests[0].URL.String(); got != "https://api.moonshot.cn/v1/users/me/balance" {
			t.Errorf("request URL = %q", got)
		}
	})

	t.Run("404s for an unknown subscription", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodPost,
			"/api/subscriptions/missing/test-connection",
			`{"credentials":{"apiKey":"x"}}`, f.cookie,
		)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Subscription not found") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})

	t.Run("requires credentials", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{Provider: "deepseek"})
		rec := request(t, f.srv, http.MethodPost,
			"/api/subscriptions/"+id+"/test-connection",
			`{"credentials":{}}`, f.cookie,
		)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
	})

	t.Run("reports unsupported providers", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{Provider: "anthropic"})
		rec := request(t, f.srv, http.MethodPost,
			"/api/subscriptions/"+id+"/test-connection",
			`{"credentials":{"apiKey":"x"}}`, f.cookie,
		)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Test connection not supported for anthropic") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})
}
