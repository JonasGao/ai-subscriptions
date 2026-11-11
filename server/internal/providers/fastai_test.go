package providers

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// FastAI's GET /v1/usage is a wallet-balance endpoint: it serves one-time
// subscriptions only. These tests pin the ccswitch usageScript extractor
// contract against that余额 handler:
//
//	remaining = remaining ?? quota?.remaining ?? balance
//	unit      = unit      ?? quota?.unit      ?? "USD"
//	isValid   = is_active ?? isValid          ?? true
//
// A live probe (overdrawn account) returned the flat payload used in the first
// case below. Deliberately no balance_infos / data[] branching: that shape
// belongs to dddai, not FastAI.

func TestFastAIBalanceHandler(t *testing.T) {
	t.Run("real probe payload maps to BalanceResult", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"balance":-0.02009565,"isValid":true,"planName":"钱包余额","remaining":-0.02009565,"unit":"USD"}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.Provider != "fastai" {
			t.Errorf("provider = %q, want fastai", result.Provider)
		}
		if !result.IsAvailable {
			t.Error("isAvailable = false, want true")
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		info := result.BalanceInfos[0]
		if info.Currency != "USD" || info.Available != "-0.02" {
			t.Errorf("info = (%q, %q), want (USD, -0.02)", info.Currency, info.Available)
		}
		assertPtr(t, "total", info.Total, "钱包余额")
	})

	t.Run("remaining wins over quota.remaining and balance (?? chain)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":12.5,"quota":{"remaining":99,"unit":"CNY"},"balance":88,"unit":"USD"}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "12.50" {
			t.Errorf("Available = %q, want 12.50", result.BalanceInfos[0].Available)
		}
		if result.BalanceInfos[0].Currency != "USD" {
			t.Errorf("currency = %q, want USD", result.BalanceInfos[0].Currency)
		}
	})

	t.Run("quota.remaining / quota.unit used when top-level absent", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"quota":{"remaining":7,"unit":"CNY"},"balance":3}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "7.00" {
			t.Errorf("Available = %q, want 7.00", result.BalanceInfos[0].Available)
		}
		if result.BalanceInfos[0].Currency != "CNY" {
			t.Errorf("currency = %q, want CNY", result.BalanceInfos[0].Currency)
		}
	})

	t.Run("balance and USD defaults when only balance is present", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"balance":25}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "25.00" {
			t.Errorf("Available = %q, want 25.00", result.BalanceInfos[0].Available)
		}
		if result.BalanceInfos[0].Currency != "USD" {
			t.Errorf("currency = %q, want USD", result.BalanceInfos[0].Currency)
		}
	})

	t.Run("explicit remaining: 0 is not skipped by ?? (differs from ||)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":0,"balance":42}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "0.00" {
			t.Errorf("Available = %q, want 0.00", result.BalanceInfos[0].Available)
		}
	})

	t.Run("JSON null falls through the ?? chain", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":null,"quota":{"remaining":null},"balance":9}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "9.00" {
			t.Errorf("Available = %q, want 9.00", result.BalanceInfos[0].Available)
		}
	})

	t.Run("is_active: false marks the account unavailable", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"is_active":false,"remaining":10,"unit":"USD"}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.IsAvailable {
			t.Error("isAvailable = true, want false")
		}
	})

	t.Run("isValid: false also marks unavailable when is_active absent", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"isValid":false,"remaining":10,"unit":"USD"}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if result.IsAvailable {
			t.Error("isAvailable = true, want false")
		}
	})

	t.Run("defaults planName to 余额 and unit to USD", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":3}`}

		result, err := FetchFastAIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIBalance: %v", err)
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		if result.BalanceInfos[0].Currency != "USD" {
			t.Errorf("currency = %q, want USD", result.BalanceInfos[0].Currency)
		}
		assertPtr(t, "total", result.BalanceInfos[0].Total, "余额")
	})

	t.Run("API error surfaces status code", func(t *testing.T) {
		_, err := FetchFastAIBalance(context.Background(), cannedHTTPDoer{statusCode: http.StatusForbidden, body: "Forbidden"}, "k")
		if err == nil || !strings.Contains(err.Error(), "FastAI API returned 403") {
			t.Errorf("err = %v, want FastAI API returned 403", err)
		}
	})
}

// TestFastAIHandlerRequest verifies the outbound contract from ccswitch:
// GET /v1/usage with Authorization: Bearer <apiKey>.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) Do(req *http.Request) (*http.Response, error) { return f(req) }

func TestFastAIHandlerRequest(t *testing.T) {
	var gotURL, gotAuth, gotMethod string
	client := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		gotURL = req.URL.String()
		gotAuth = req.Header.Get("Authorization")
		gotMethod = req.Method
		return cannedHTTPDoer{body: `{"remaining":1,"unit":"USD"}`}.Do(req)
	})

	if _, err := FetchFastAIBalance(context.Background(), client, "sk-test-key"); err != nil {
		t.Fatalf("FetchFastAIBalance: %v", err)
	}
	if gotURL != fastaiBalanceURL {
		t.Errorf("url = %q, want %q", gotURL, fastaiBalanceURL)
	}
	if gotAuth != "Bearer sk-test-key" {
		t.Errorf("Authorization = %q, want Bearer sk-test-key", gotAuth)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
}

// TestFastAICapabilities pins that the /v1/usage endpoint is a one-time-only
// 余额 query: no usageApiUrl and no registered usage handler.
func TestFastAICapabilities(t *testing.T) {
	provider, ok := ProviderByID("fastai")
	if !ok {
		t.Fatal("fastai missing from registry")
	}
	if provider.BalanceAPIURL != fastaiBalanceURL {
		t.Errorf("BalanceAPIURL = %q, want %q", provider.BalanceAPIURL, fastaiBalanceURL)
	}
	if provider.UsageAPIURL != "" {
		t.Errorf("UsageAPIURL = %q, want empty (one-time only)", provider.UsageAPIURL)
	}
	if SupportsUsageQuery("fastai") {
		t.Error("SupportsUsageQuery(fastai) = true, want false")
	}
	if !SupportsBalanceQuery("fastai") {
		t.Error("SupportsBalanceQuery(fastai) = false, want true")
	}
	if ResolveUsageAPIURL(provider, "") != "" {
		t.Error("ResolveUsageAPIURL should be empty for fastai")
	}
}
