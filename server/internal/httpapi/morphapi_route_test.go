package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ai-subscriptions/internal/store"
)

// TestMorphAPIQueryRoutes closes the end-to-end wiring for the MorphAPI
// provider: a recurring subscription dispatches to the usage handler and a
// one-time subscription to the balance handler, both against GET /v1/usage
// with the stored apiKey decrypted into a Bearer header.
const morphapiProbeBody = `{"remaining":27.431972,"unit":"USD","is_active":true,"isValid":true,"planName":"订阅"}`

func TestMorphAPIQueryRoutes(t *testing.T) {
	t.Run("recurring subscription queries usage", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, morphapiProbeBody)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "morphapi",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
			Credentials:      f.encrypt(t, map[string]string{"apiKey": "sk-morphapi"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}

		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if payload["provider"] != "morphapi" {
			t.Errorf("provider = %v, want morphapi", payload["provider"])
		}
		monthly, ok := payload["monthly"].(map[string]any)
		if !ok {
			t.Fatalf("monthly = %v, want a window", payload["monthly"])
		}
		if monthly["remaining"] != "27.43" || monthly["limit"] != "27.43" || monthly["used"] != "0.00" {
			t.Errorf("monthly = %v, want remaining/limit 27.43 and used 0.00", monthly)
		}
		warnings, _ := payload["warnings"].([]any)
		if len(warnings) == 0 {
			t.Errorf("warnings = %v, want额度 metadata lines", payload["warnings"])
		}

		if len(f.client.requests) != 1 {
			t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
		}
		req := f.client.requests[0]
		if got := req.URL.String(); got != "https://www.aidjapi.top/v1/usage" {
			t.Errorf("url = %q, want MorphAPI /v1/usage", got)
		}
		if got := req.Header.Get("Authorization"); got != "Bearer sk-morphapi" {
			t.Errorf("Authorization = %q, want Bearer sk-morphapi", got)
		}
	})

	t.Run("one-time subscription queries balance", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, morphapiProbeBody)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "morphapi",
			SubscriptionType: "one-time",
			Credentials:      f.encrypt(t, map[string]string{"apiKey": "sk-morphapi"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/balance", "", f.cookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}

		var payload struct {
			Provider     string `json:"provider"`
			IsAvailable  bool   `json:"isAvailable"`
			BalanceInfos []struct {
				Currency  string  `json:"currency"`
				Available string  `json:"available"`
				Total     *string `json:"total"`
			} `json:"balanceInfos"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if payload.Provider != "morphapi" || !payload.IsAvailable {
			t.Errorf("provider/available = %q/%v, want morphapi/true", payload.Provider, payload.IsAvailable)
		}
		if len(payload.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos = %d, want 1", len(payload.BalanceInfos))
		}
		info := payload.BalanceInfos[0]
		if info.Currency != "USD" || info.Available != "27.43" {
			t.Errorf("info = (%q, %q), want (USD, 27.43)", info.Currency, info.Available)
		}
		if info.Total == nil || *info.Total != "27.43" {
			t.Errorf("total = %v, want 27.43 (the queried quota)", info.Total)
		}
	})

	t.Run("test-connection dispatches to the MorphAPI usage handler", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, morphapiProbeBody)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"morphapi","credentials":{"apiKey":"sk-morphapi"}}`, f.cookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		var result struct {
			OK      bool   `json:"ok"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if !result.OK {
			t.Errorf("ok = false, message = %q", result.Message)
		}
	})

	t.Run("panel error propagates as a 502 with the decoded message", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, "")
		f.client.statusCode = http.StatusForbidden
		f.client.body = `{"code":"GROUP_DELETED","message":"API Key 所属分组已删除"}`
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "morphapi",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
			Credentials:      f.encrypt(t, map[string]string{"apiKey": "dead-key"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
		}
		if body := rec.Body.String(); !strings.Contains(body, "API Key 所属分组已删除") || !strings.Contains(body, "GROUP_DELETED") {
			t.Errorf("body = %q, want decoded panel message and code", body)
		}
	})
}
