package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// Route-level guards for GET /api/subscriptions/{id}/usage. The usage-route
// parity row (2 calibration cases) belongs to #29/#34; these cases pin the
// framework this ticket lands: dispatch to the provider handler, the old
// response shape (usage fields inline + credentials-stripped subscription), and
// the no-store cache header.

func TestUsageRouteDispatchesToProviderHandler(t *testing.T) {
	body := `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2026-03-04T04:01:38Z"},"limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"200","used":"7","remaining":"193","resetTime":"2026-03-03T11:16:04Z"}}]}`
	f := newSubscriptionQueryFixture(t, body)
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:         "moonshot",
		PlanID:           "kimi-code",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Credentials:      f.encrypt(t, map[string]string{"apiKey": "kimi-key"}),
	})

	rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload["provider"] != "moonshot" {
		t.Errorf("provider = %v, want moonshot", payload["provider"])
	}
	if payload["weekly"] == nil || payload["fiveHour"] == nil {
		t.Errorf("usage windows missing: %v", payload)
	}
	subscription, ok := payload["subscription"].(map[string]any)
	if !ok {
		t.Fatalf("subscription = %v, want credentials-stripped object", payload["subscription"])
	}
	if _, leaks := subscription["credentials"]; leaks {
		t.Error("subscription.credentials leaked into the response")
	}
	if subscription["hasCredentials"] != true {
		t.Errorf("hasCredentials = %v, want true", subscription["hasCredentials"])
	}

	if len(f.client.requests) != 1 {
		t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
	}
	if got := f.client.requests[0].Header.Get("Authorization"); got != "Bearer kimi-key" {
		t.Errorf("Authorization = %q, want Bearer kimi-key", got)
	}
}

// The guard chain is already pinned by TestUsageRouteGuards (#26); this covers
// the framework branches this ticket adds.
func TestUsageRouteProviderFailures(t *testing.T) {
	t.Run("502s with the provider error message on upstream failure", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `Forbidden`)
		f.client.statusCode = http.StatusForbidden
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "moonshot",
			PlanID:           "kimi-code",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
			Credentials:      f.encrypt(t, map[string]string{"apiKey": "k"}),
		})
		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
		if rec.Code != http.StatusBadGateway {
			t.Errorf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Moonshot usage API returned 403") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})

	t.Run("502s a provider whose handler body has not landed yet", func(t *testing.T) {
		// github is a registered usage key; #31 landed alibaba:token-plan, so
		// github is the next not-yet-implemented handler in this family.
		f := newSubscriptionQueryFixture(t, `{}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "github",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
			Credentials:      f.encrypt(t, map[string]string{"token": "t"}),
		})
		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
		if rec.Code != http.StatusBadGateway {
			t.Errorf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "Usage query failed") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})
}
