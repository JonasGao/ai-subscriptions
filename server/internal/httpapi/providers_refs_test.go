package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// /api/providers used to be served with an empty reference source, so the
// subscription/tool counts were always zero. #26 wires the real store in; this
// pins the enrichment end to end.
func TestProvidersRouteCountsStoredSubscriptions(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	seedSubscription(t, db, store.SubscriptionInput{
		Name: "A", Category: "官方订阅", Provider: "deepseek", Price: 1, SubscriptionType: "one-time",
	})
	seedSubscription(t, db, store.SubscriptionInput{
		Name: "B", Category: "官方订阅", Provider: "deepseek", Price: 1, SubscriptionType: "one-time",
	})
	seedSubscription(t, db, store.SubscriptionInput{
		Name: "C", Category: "官方订阅", Provider: "other", ProviderCustom: "FooAPI", Price: 1, SubscriptionType: "one-time",
	})

	rec := request(t, srv, http.MethodGet, "/api/providers", "", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body []struct {
		ID                string `json:"id"`
		SubscriptionCount int    `json:"subscriptionCount"`
		ToolCount         int    `json:"toolCount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	counts := map[string]int{}
	for _, provider := range body {
		counts[provider.ID] = provider.SubscriptionCount
	}
	if counts["deepseek"] != 2 || counts["other"] != 1 || counts["openai"] != 0 {
		t.Fatalf("counts = %#v, want deepseek=2 other=1 openai=0", counts)
	}

	unregistered := request(t, srv, http.MethodGet, "/api/providers/unregistered", "", session)
	if got, want := unregistered.Body.String(), `[{"name":"FooAPI","count":1}]`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}
