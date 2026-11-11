package providers

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// MorphAPI's GET /v1/usage is a wallet-balance endpoint: it serves one-time
// subscriptions only. These tests pin the ccswitch usageScript extractor
// contract against that余额 handler:
//
//	remaining = remaining ?? quota.remaining ?? balance
//	unit      = unit      ?? quota.unit      ?? "USD"
//	isValid   = is_active ?? isValid         ?? true
//
// The handoff's live probe is a new-api/one-api style panel whose only captured
// bodies were 403/200 envelopes, so these cases pin the extractor contract
// itself (all three shapes) rather than a fabricated "real" payload.

func TestMorphAPIBalanceHandler(t *testing.T) {
	t.Run("flat payload maps to BalanceResult", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":27.431972,"unit":"USD","is_active":true,"planName":"订阅"}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if result.Provider != "morphapi" {
			t.Errorf("provider = %q, want morphapi", result.Provider)
		}
		if !result.IsAvailable {
			t.Error("isAvailable = false, want true")
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		info := result.BalanceInfos[0]
		if info.Currency != "USD" || info.Available != "27.43" {
			t.Errorf("info = (%q, %q), want (USD, 27.43)", info.Currency, info.Available)
		}
		assertPtr(t, "total", info.Total, "订阅")
	})

	t.Run("remaining wins over quota.remaining and balance (?? chain)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":12.5,"quota":{"remaining":99,"unit":"CNY"},"balance":88,"unit":"USD"}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
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

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
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

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
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

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "0.00" {
			t.Errorf("Available = %q, want 0.00", result.BalanceInfos[0].Available)
		}
	})

	t.Run("JSON null falls through the ?? chain", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":null,"quota":{"remaining":null},"balance":9}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if result.BalanceInfos[0].Available != "9.00" {
			t.Errorf("Available = %q, want 9.00", result.BalanceInfos[0].Available)
		}
	})

	t.Run("is_active: false marks the account unavailable", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"is_active":false,"remaining":10,"unit":"USD"}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if result.IsAvailable {
			t.Error("isAvailable = true, want false")
		}
	})

	t.Run("isValid: false also marks unavailable when is_active absent", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"isValid":false,"remaining":10,"unit":"USD"}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if result.IsAvailable {
			t.Error("isAvailable = true, want false")
		}
	})

	t.Run("defaults planName to 余额 and unit to USD", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":3}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos = %d, want 1", len(result.BalanceInfos))
		}
		if result.BalanceInfos[0].Currency != "USD" {
			t.Errorf("currency = %q, want USD", result.BalanceInfos[0].Currency)
		}
		assertPtr(t, "total", result.BalanceInfos[0].Total, "余额")
	})

	t.Run("GROUP_DELETED panel error surfaces code and message", func(t *testing.T) {
		client := cannedHTTPDoer{
			statusCode: http.StatusForbidden,
			body:       `{"code":"GROUP_DELETED","message":"API Key 所属分组已删除"}`,
		}

		_, err := FetchMorphAPIBalance(context.Background(), client, "dead-key")
		if err == nil {
			t.Fatal("err = nil, want an error")
		}
		if !strings.Contains(err.Error(), "MorphAPI API returned 403") ||
			!strings.Contains(err.Error(), "API Key 所属分组已删除") ||
			!strings.Contains(err.Error(), "GROUP_DELETED") {
			t.Errorf("err = %v, want status, message and code", err)
		}
	})

	t.Run("plain non-JSON error falls back to status text", func(t *testing.T) {
		client := cannedHTTPDoer{statusCode: http.StatusUnauthorized, body: "Unauthorized"}

		_, err := FetchMorphAPIBalance(context.Background(), client, "k")
		if err == nil || !strings.Contains(err.Error(), "MorphAPI API returned 401") {
			t.Errorf("err = %v, want MorphAPI API returned 401", err)
		}
	})
}

// TestMorphAPIHandlerRequest verifies the outbound contract from ccswitch:
// GET {baseUrl}/v1/usage with Authorization: Bearer <apiKey>.
func TestMorphAPIHandlerRequest(t *testing.T) {
	var gotURL, gotAuth, gotMethod string
	client := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		gotURL = req.URL.String()
		gotAuth = req.Header.Get("Authorization")
		gotMethod = req.Method
		return cannedHTTPDoer{body: `{"remaining":1,"unit":"USD"}`}.Do(req)
	})

	if _, err := FetchMorphAPIBalance(context.Background(), client, "sk-test-key"); err != nil {
		t.Fatalf("FetchMorphAPIBalance: %v", err)
	}
	if gotURL != morphapiBalanceURL {
		t.Errorf("url = %q, want %q", gotURL, morphapiBalanceURL)
	}
	if gotAuth != "Bearer sk-test-key" {
		t.Errorf("Authorization = %q, want Bearer sk-test-key", gotAuth)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
}

// TestMorphAPICapabilities pins that the /v1/usage endpoint is a one-time-only
// 余额 query: no usageApiUrl and no registered usage handler.
func TestMorphAPICapabilities(t *testing.T) {
	provider, ok := ProviderByID("morphapi")
	if !ok {
		t.Fatal("morphapi missing from registry")
	}
	if provider.BalanceAPIURL != morphapiBalanceURL {
		t.Errorf("BalanceAPIURL = %q, want %q", provider.BalanceAPIURL, morphapiBalanceURL)
	}
	if provider.UsageAPIURL != "" {
		t.Errorf("UsageAPIURL = %q, want empty (one-time only)", provider.UsageAPIURL)
	}
	if SupportsUsageQuery("morphapi") {
		t.Error("SupportsUsageQuery(morphapi) = true, want false")
	}
	if !SupportsBalanceQuery("morphapi") {
		t.Error("SupportsBalanceQuery(morphapi) = false, want true")
	}
	if !SupportsModelsQuery(provider) {
		t.Error("SupportsModelsQuery(morphapi) = false, want true")
	}
	if ResolveUsageAPIURL(provider, "") != "" {
		t.Error("ResolveUsageAPIURL should be empty for morphapi")
	}
}
