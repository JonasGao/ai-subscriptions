package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/model"
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
}

// TestUsageRouteCalibratesAndEchoesSubscription closes the #34 half of the
// usage-route parity row: a successful query reverse-derives the schedule
// config, persists it, and echoes the calibrated (credentials-stripped)
// subscription so the frontend can replace its list entry without a refetch
// (ADR-0016).
func TestUsageRouteCalibratesAndEchoesSubscription(t *testing.T) {
	body := `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2099-03-04T04:01:38Z"},"limits":[]}`
	f := newSubscriptionQueryFixture(t, body)
	dayOfWeek := 0
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:         "moonshot",
		PlanID:           "kimi-code",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Credentials:      f.encrypt(t, map[string]string{"apiKey": "kimi-key"}),
		ResetSchedules: []model.ResetSchedule{{
			ID:            "sched-weekly",
			Enabled:       true,
			Type:          "weekly",
			Timezone:      "UTC",
			DayOfWeek:     &dayOfWeek,
			TimeOfDay:     "00:00",
			NextResetTime: "2024-01-01T00:00:00Z",
			CreatedAt:     "2024-01-01T00:00:00Z",
			UpdatedAt:     "2024-01-01T00:00:00Z",
		}},
	})

	rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}

	var payload struct {
		Subscription struct {
			ResetSchedules []model.ResetSchedule `json:"resetSchedules"`
		} `json:"subscription"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(payload.Subscription.ResetSchedules) != 1 {
		t.Fatalf("resetSchedules = %#v, want one", payload.Subscription.ResetSchedules)
	}
	echoed := payload.Subscription.ResetSchedules[0]
	if echoed.NextResetTime != "2099-03-04T04:01:38Z" {
		t.Errorf("echoed nextResetTime = %q", echoed.NextResetTime)
	}
	if echoed.DayOfWeek == nil || *echoed.DayOfWeek != 3 {
		t.Errorf("echoed dayOfWeek = %v, want 3", echoed.DayOfWeek)
	}
	if echoed.TimeOfDay != "04:01" {
		t.Errorf("echoed timeOfDay = %q, want 04:01", echoed.TimeOfDay)
	}

	saved, err := f.db.SubscriptionByID(id)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.ResetSchedules[0].NextResetTime != "2099-03-04T04:01:38Z" {
		t.Errorf("persisted nextResetTime = %q", saved.ResetSchedules[0].NextResetTime)
	}
	if saved.ResetSchedules[0].DayOfWeek == nil || *saved.ResetSchedules[0].DayOfWeek != 3 {
		t.Errorf("persisted dayOfWeek = %v, want 3", saved.ResetSchedules[0].DayOfWeek)
	}
}
