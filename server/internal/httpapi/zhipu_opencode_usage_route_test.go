package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// Route-level demonstration of the #33 browser flow: GET
// /api/subscriptions/{id}/usage for recurring zhipu coding-plan and opencode
// go subscriptions dispatches to the ported handlers and echoes the
// credentials-stripped subscription the card renders. (The third provider in
// this ticket, moonshot:kimi-code, is demonstrated by
// TestUsageRouteDispatchesToProviderHandler.)
func TestZhipuUsageRoute(t *testing.T) {
	body := `{"code":200,"msg":"ok","data":{"limits":[
		{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":3000,"remaining":9000},
		{"type":"CREDIT_LIMIT","unit":6,"number":1,"usage":60000,"currentValue":15000,"remaining":45000,"nextResetTime":1790302548999}
	],"level":"pro"},"success":true}`

	f := newSubscriptionQueryFixture(t, body)
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:         "zhipu",
		PlanID:           "coding-plan",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Credentials:      f.encrypt(t, map[string]string{"apiKey": "zhipu-route-key"}),
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
	if payload["provider"] != "zhipu" {
		t.Errorf("provider = %v, want zhipu", payload["provider"])
	}
	assertRouteWindow(t, "fiveHour", payload["fiveHour"], "12000", "3000", "9000")
	assertRouteWindow(t, "weekly", payload["weekly"], "60000", "15000", "45000")
	if payload["monthly"] != nil {
		t.Errorf("monthly = %v, want nil", payload["monthly"])
	}

	subscription, ok := payload["subscription"].(map[string]any)
	if !ok {
		t.Fatalf("subscription = %v, want object", payload["subscription"])
	}
	if _, leaks := subscription["credentials"]; leaks {
		t.Error("subscription.credentials leaked into the response")
	}

	if len(f.client.requests) != 1 {
		t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
	}
	req := f.client.requests[0]
	if req.URL.String() != "https://open.bigmodel.cn/api/monitor/usage/quota/limit" {
		t.Errorf("url = %q, want BigModel quota endpoint", req.URL.String())
	}
	if got := req.Header.Get("Authorization"); got != "zhipu-route-key" {
		t.Errorf("Authorization = %q, want bare API key", got)
	}
}

func TestOpencodeGoUsageRoute(t *testing.T) {
	body := `{"usage":{
		"rolling":{"status":"ok","percent":25,"resetsAt":"2026-09-13T11:26:17.325Z"},
		"weekly":{"status":"rate-limited","percent":60,"resetsAt":"2026-09-14T00:00:00.325Z"},
		"monthly":{"status":"ok","percent":11,"resetsAt":"2026-10-10T11:03:46.325Z"}
	}}`

	f := newSubscriptionQueryFixture(t, body)
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:         "opencode",
		PlanID:           "go",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Credentials:      f.encrypt(t, map[string]string{"apiKey": "oc-route-key"}),
	})

	rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload["provider"] != "opencode" {
		t.Errorf("provider = %v, want opencode", payload["provider"])
	}
	assertRouteWindow(t, "fiveHour", payload["fiveHour"], "100", "25", "75")
	// rate-limited forces the window to 100 so auto-exhaust fires (#29).
	assertRouteWindow(t, "weekly", payload["weekly"], "100", "100", "0")
	assertRouteWindow(t, "monthly", payload["monthly"], "100", "11", "89")

	if len(f.client.requests) != 1 {
		t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
	}
	req := f.client.requests[0]
	if req.URL.String() != "https://opencode.ai/zen/go/v1/usage" {
		t.Errorf("url = %q, want opencode usage endpoint", req.URL.String())
	}
	if got := req.Header.Get("Authorization"); got != "Bearer oc-route-key" {
		t.Errorf("Authorization = %q, want Bearer oc-route-key", got)
	}
}

// An expired OpenCode key surfaces the dedicated 401 message through the route,
// distinct from an invalid key.
func TestOpencodeGoUsageRouteExpiredKey(t *testing.T) {
	f := newSubscriptionQueryFixture(t, `{"error":{"type":"authentication_error","code":"api_key_expired"}}`)
	f.client.statusCode = http.StatusUnauthorized
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:         "opencode",
		PlanID:           "go",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Credentials:      f.encrypt(t, map[string]string{"apiKey": "expired-key"}),
	})

	rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
	if !containsText(rec.Body.String(), "API Key 已过期") {
		t.Errorf("body = %q, want expired-key hint", rec.Body.String())
	}
}
