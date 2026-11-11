package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// TestFastAIQueryRoutes closes the end-to-end wiring for the FastAI provider:
// /v1/usage is a wallet-balance endpoint serving one-time subscriptions only,
// so the balance route dispatches to the handler while the usage route for a
// recurring subscription is rejected.
const fastaiProbeBody = `{"balance":12.345,"isValid":true,"mode":"unrestricted","planName":"订阅","remaining":12.345,"unit":"USD"}`

func TestFastAIQueryRoutes(t *testing.T) {
	t.Run("one-time subscription queries balance", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, fastaiProbeBody)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "fastai",
			SubscriptionType: "one-time",
			Credentials:      f.encrypt(t, map[string]string{"apiKey": "sk-fastai"}),
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
		if payload.Provider != "fastai" || !payload.IsAvailable {
			t.Errorf("provider/available = %q/%v, want fastai/true", payload.Provider, payload.IsAvailable)
		}
		if len(payload.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos = %d, want 1", len(payload.BalanceInfos))
		}
		info := payload.BalanceInfos[0]
		if info.Currency != "USD" || info.Available != "12.35" {
			t.Errorf("info = (%q, %q), want (USD, 12.35)", info.Currency, info.Available)
		}
		if info.Total == nil || *info.Total != "订阅" {
			t.Errorf("total = %v, want 订阅", info.Total)
		}

		if len(f.client.requests) != 1 {
			t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
		}
		req := f.client.requests[0]
		if got := req.URL.String(); got != "https://www.fastaitoken.com/v1/usage" {
			t.Errorf("url = %q, want FastAI /v1/usage", got)
		}
		if got := req.Header.Get("Authorization"); got != "Bearer sk-fastai" {
			t.Errorf("Authorization = %q, want Bearer sk-fastai", got)
		}
	})

	t.Run("recurring subscription has no usage endpoint", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, fastaiProbeBody)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "fastai",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
			Credentials:      f.encrypt(t, map[string]string{"apiKey": "sk-fastai"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/usage", "", f.cookie)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
		if len(f.client.requests) != 0 {
			t.Errorf("outbound requests = %d, want 0 (no usage endpoint)", len(f.client.requests))
		}
	})

	t.Run("test-connection dispatches to the FastAI balance handler", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, fastaiProbeBody)
		rec := request(t, f.srv, http.MethodPost, "/api/test-connection",
			`{"provider":"fastai","credentials":{"apiKey":"sk-fastai"}}`, f.cookie)
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
}
