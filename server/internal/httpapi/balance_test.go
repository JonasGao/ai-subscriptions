package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// Route-level guards for GET /api/subscriptions/{id}/balance. The old stack had
// no route test for this handler; behaviour is pinned against its implementation
// (lib/providers + app/api/subscriptions/[id]/balance/route.ts), which #28's
// acceptance requires to be byte-aligned.

func TestBalanceRouteWritesBackTotalBalance(t *testing.T) {
	f := newSubscriptionQueryFixture(t, `{"status":true,"data":{"available_balance":399.5,"voucher_balance":50,"cash_balance":349.5}}`)
	id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
		Provider:            "moonshot",
		SubscriptionType:    "one-time",
		Credentials:         f.encrypt(t, map[string]string{"apiKey": "k"}),
		Balance:             floatPtr(500),
		LowBalanceThreshold: floatPtr(10),
	})

	rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/balance", "", f.cookie)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}

	// Response is the BalanceResult wire shape.
	var body struct {
		Provider     string `json:"provider"`
		IsAvailable  bool   `json:"isAvailable"`
		BalanceInfos []struct {
			Currency  string  `json:"currency"`
			Available string  `json:"available"`
			ToppedUp  *string `json:"toppedUp"`
			Granted   *string `json:"granted"`
			Total     *string `json:"total"`
		} `json:"balanceInfos"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body %q)", err, rec.Body.String())
	}
	if body.Provider != "moonshot" || !body.IsAvailable {
		t.Errorf("body = %+v", body)
	}
	if len(body.BalanceInfos) != 1 || body.BalanceInfos[0].Available != "399.50" {
		t.Fatalf("balanceInfos = %+v", body.BalanceInfos)
	}

	// Total balance is written back onto the subscription (amount + currency),
	// and unrelated fields (low-balance threshold) survive.
	saved, err := f.db.SubscriptionByID(id)
	if err != nil || saved == nil {
		t.Fatalf("reload subscription: %v", err)
	}
	if saved.Balance == nil || *saved.Balance != 399.5 {
		t.Errorf("balance = %v, want 399.5", saved.Balance)
	}
	if saved.BalanceCurrency != "CNY" {
		t.Errorf("balanceCurrency = %q, want CNY", saved.BalanceCurrency)
	}
	if saved.LowBalanceThreshold == nil || *saved.LowBalanceThreshold != 10 {
		t.Errorf("lowBalanceThreshold = %v, want 10", saved.LowBalanceThreshold)
	}
}

func TestBalanceRouteGuards(t *testing.T) {
	t.Run("404s an unknown subscription", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/nope/balance", "", f.cookie)
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("400s a provider without a balance endpoint", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{Provider: "anthropic"})
		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/balance", "", f.cookie)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
		if !containsText(rec.Body.String(), "Balance query not supported for anthropic") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})

	t.Run("400s a subscription without credentials", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{Provider: "deepseek"})
		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/balance", "", f.cookie)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
		if !containsText(rec.Body.String(), "Credentials are not configured") {
			t.Errorf("body = %q", rec.Body.String())
		}
		if len(f.client.requests) != 0 {
			t.Errorf("outbound requests = %d, want 0", len(f.client.requests))
		}
	})

	t.Run("502s with the provider error message on upstream failure", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `Unauthorized`)
		f.client.statusCode = http.StatusUnauthorized
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:    "deepseek",
			Credentials: f.encrypt(t, map[string]string{"apiKey": "bad"}),
		})
		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/balance", "", f.cookie)
		if rec.Code != http.StatusBadGateway {
			t.Errorf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
		}
		if !containsText(rec.Body.String(), "DeepSeek API returned 401") {
			t.Errorf("body = %q", rec.Body.String())
		}
	})
}

// The four balance providers are wired end to end; the mapping itself is pinned
// in internal/providers/balance_test.go.
func TestBalanceRouteSupportsFourProviders(t *testing.T) {
	cases := map[string]string{
		"moonshot":    `{"status":true,"data":{"available_balance":12.5}}`,
		"deepseek":    `{"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"7.25"}]}`,
		"siliconflow": `{"code":20000,"status":"normal","data":{"totalBalance":"3.50","status":"normal"}}`,
		"openrouter":  `{"data":{"total_credits":10,"total_usage":4}}`,
	}
	for provider, body := range cases {
		t.Run(provider, func(t *testing.T) {
			f := newSubscriptionQueryFixture(t, body)
			id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
				Provider:    provider,
				Credentials: f.encrypt(t, map[string]string{"apiKey": "k"}),
			})
			rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/balance", "", f.cookie)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
			}
			saved, err := f.db.SubscriptionByID(id)
			if err != nil || saved == nil {
				t.Fatalf("reload: %v", err)
			}
			if saved.Balance == nil {
				t.Errorf("balance was not written back")
			}
		})
	}
}

func floatPtr(v float64) *float64 { return &v }
