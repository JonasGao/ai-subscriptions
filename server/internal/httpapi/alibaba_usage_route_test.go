package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"ai-subscriptions/internal/store"
)

// Route-level demonstration of the Alibaba Token Plan browser flow (#31):
// GET /api/subscriptions/{id}/usage for a recurring alibaba:token-plan
// subscription dispatches to the ACS3-signed seat-detail handler, buckets the
// equities into usage windows, and echoes the credentials-stripped
// subscription the card renders.
func TestAlibabaTokenPlanUsageRoute(t *testing.T) {
	const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	const now = 1717000000000.0
	body := `{"Success":true,"Data":{"Items":[{"SeatId":"seat-1","EquityList":[` +
		`{"CycleStartTime":` + intString(now-5*3600*1000) + `,"CycleEndTime":` + intString(now) + `,"CycleTotalValue":100,"CycleSurplusValue":60},` +
		`{"CycleStartTime":` + intString(now-7*24*3600*1000) + `,"CycleEndTime":` + intString(now) + `,"CycleTotalValue":5000,"CycleSurplusValue":4000},` +
		`{"CycleStartTime":` + intString(now-30*24*3600*1000) + `,"CycleEndTime":` + intString(now) + `,"CycleTotalValue":20000,"CycleSurplusValue":15000}` +
		`]}],"Total":1,"PageNo":1,"PageSize":10}}`

	f := newSubscriptionQueryFixture(t, body)
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:         "alibaba",
		PlanID:           "token-plan",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Credentials:      f.encrypt(t, map[string]string{"ak": "test-ak", "sk": "test-sk", "workspaceId": "ws_test"}),
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
	if payload["provider"] != "alibaba" {
		t.Errorf("provider = %v, want alibaba", payload["provider"])
	}
	assertRouteWindow(t, "fiveHour", payload["fiveHour"], "100", "40", "60")
	assertRouteWindow(t, "weekly", payload["weekly"], "5000", "1000", "4000")
	assertRouteWindow(t, "monthly", payload["monthly"], "20000", "5000", "15000")

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
	if !strings.Contains(req.URL.String(), "/tokenplan/subscription/seat-detail?") {
		t.Errorf("url = %q, want seat-detail endpoint", req.URL.String())
	}
	if !strings.Contains(req.URL.RawQuery, "NamespaceId=namespace-1") || !strings.Contains(req.URL.RawQuery, "WorkspaceId=ws_test") {
		t.Errorf("query = %q, want NamespaceId + WorkspaceId", req.URL.RawQuery)
	}
	if got := req.Header.Get("X-Acs-Action"); got != "GetSubscriptionSeatDetails" {
		t.Errorf("X-Acs-Action = %q", got)
	}
	if got := req.Header.Get("X-Acs-Content-Sha256"); got != emptySHA256 {
		t.Errorf("X-Acs-Content-Sha256 = %q, want empty-body hash", got)
	}
	if auth := req.Header.Get("Authorization"); !strings.HasPrefix(auth, "ACS3-HMAC-SHA256 Credential=test-ak,") {
		t.Errorf("Authorization = %q, want ACS3-HMAC-SHA256 prefix", auth)
	}
}

func assertRouteWindow(t *testing.T, label string, raw any, limit, used, remaining string) {
	t.Helper()
	window, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("%s = %v, want window object", label, raw)
	}
	if window["limit"] != limit || window["used"] != used || window["remaining"] != remaining {
		t.Errorf("%s = %v, want limit=%s used=%s remaining=%s", label, window, limit, used, remaining)
	}
}

// intString emits an integer-valued float as a decimal integer string.
func intString(f float64) string {
	return strconv.FormatInt(int64(f), 10)
}
