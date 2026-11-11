package providers

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// The MorphAPI handlers are driven by the ccswitch usageScript contract
// documented in the handoff and implemented by the shared parseRelayQuota:
//
//	remaining = remaining ?? quota.remaining ?? balance
//	unit      = unit      ?? quota.unit      ?? "USD"
//	isValid   = is_active ?? isValid         ?? true
//
// The handoff's live probe is a new-api/one-api style panel whose only captured
// bodies were 403/200 envelopes, so these cases pin the extractor contract
// itself (all three shapes) rather than a fabricated "real" payload.

func TestMorphAPIUsageHandler(t *testing.T) {
	t.Run("flat payload maps remaining into Monthly window", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":27.431972,"unit":"USD","is_active":true,"planName":"订阅"}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if result.Provider != "morphapi" {
			t.Errorf("provider = %q, want morphapi", result.Provider)
		}
		if result.Monthly == nil {
			t.Fatal("Monthly = nil, want non-nil")
		}
		if result.Monthly.Limit != "27.43" || result.Monthly.Remaining != "27.43" || result.Monthly.Used != "0.00" {
			t.Errorf("Monthly = %+v, want limit/remaining 27.43 and used 0.00", result.Monthly)
		}
		if result.FiveHour != nil || result.Weekly != nil {
			t.Errorf("5h/weekly should be nil for a wallet relay: %+v / %+v", result.FiveHour, result.Weekly)
		}
		assertStrings(t, result.Warnings, []string{"订阅 · USD"})
	})

	t.Run("remaining wins over quota.remaining and balance (?? chain)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":12.5,"quota":{"remaining":99,"unit":"CNY"},"balance":88,"unit":"USD"}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if result.Monthly.Remaining != "12.50" {
			t.Errorf("Monthly.Remaining = %q, want 12.50", result.Monthly.Remaining)
		}
		assertStrings(t, result.Warnings, []string{"余额 · USD"})
	})

	t.Run("quota.remaining / quota.unit used when top-level absent", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"quota":{"remaining":7,"unit":"CNY"},"balance":3}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if result.Monthly.Remaining != "7.00" {
			t.Errorf("Monthly.Remaining = %q, want 7.00", result.Monthly.Remaining)
		}
		assertStrings(t, result.Warnings, []string{"余额 · CNY"})
	})

	t.Run("balance and USD defaults when only balance is present", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"balance":25}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if result.Monthly.Remaining != "25.00" {
			t.Errorf("Monthly.Remaining = %q, want 25.00", result.Monthly.Remaining)
		}
		assertStrings(t, result.Warnings, []string{"余额 · USD"})
	})

	t.Run("explicit remaining: 0 is not skipped by ?? (differs from ||)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":0,"balance":42}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if result.Monthly.Remaining != "0.00" {
			t.Errorf("Monthly.Remaining = %q, want 0.00", result.Monthly.Remaining)
		}
	})

	t.Run("JSON null falls through the ?? chain", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":null,"quota":{"remaining":null},"balance":9}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if result.Monthly.Remaining != "9.00" {
			t.Errorf("Monthly.Remaining = %q, want 9.00", result.Monthly.Remaining)
		}
	})

	t.Run("is_active: false surfaces an invalid-account warning", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"is_active":false,"isValid":true,"remaining":5,"unit":"USD"}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if !containsString(result.Warnings, "账户状态: 无效") {
			t.Errorf("Warnings = %v, want an invalid-account line", result.Warnings)
		}
	})

	t.Run("isValid: false also marks invalid when is_active absent", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"isValid":false,"remaining":5,"unit":"USD"}`}

		result, err := FetchMorphAPIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIUsage: %v", err)
		}
		if !containsString(result.Warnings, "账户状态: 无效") {
			t.Errorf("Warnings = %v, want an invalid-account line", result.Warnings)
		}
	})

	t.Run("GROUP_DELETED panel error surfaces code and message", func(t *testing.T) {
		client := cannedHTTPDoer{
			statusCode: http.StatusForbidden,
			body:       `{"code":"GROUP_DELETED","message":"API Key 所属分组已删除"}`,
		}

		_, err := FetchMorphAPIUsage(context.Background(), client, "dead-key")
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

		_, err := FetchMorphAPIUsage(context.Background(), client, "k")
		if err == nil || !strings.Contains(err.Error(), "MorphAPI API returned 401") {
			t.Errorf("err = %v, want MorphAPI API returned 401", err)
		}
	})
}

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
		assertPtr(t, "total", info.Total, "27.43")
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

	t.Run("quota shape drives currency and amount", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"quota":{"remaining":7.5,"unit":"CNY"}}`}

		result, err := FetchMorphAPIBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMorphAPIBalance: %v", err)
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos = %d, want 1", len(result.BalanceInfos))
		}
		if result.BalanceInfos[0].Currency != "CNY" || result.BalanceInfos[0].Available != "7.50" {
			t.Errorf("info = (%q, %q), want (CNY, 7.50)", result.BalanceInfos[0].Currency, result.BalanceInfos[0].Available)
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
		assertPtr(t, "total", result.BalanceInfos[0].Total, "3.00")
	})

	t.Run("API error surfaces status code", func(t *testing.T) {
		_, err := FetchMorphAPIBalance(context.Background(), cannedHTTPDoer{statusCode: http.StatusForbidden, body: "Forbidden"}, "k")
		if err == nil || !strings.Contains(err.Error(), "MorphAPI API returned 403") {
			t.Errorf("err = %v, want MorphAPI API returned 403", err)
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

	if _, err := FetchMorphAPIUsage(context.Background(), client, "sk-test-key"); err != nil {
		t.Fatalf("FetchMorphAPIUsage: %v", err)
	}
	if gotURL != morphapiUsageURL {
		t.Errorf("url = %q, want %q", gotURL, morphapiUsageURL)
	}
	if gotAuth != "Bearer sk-test-key" {
		t.Errorf("Authorization = %q, want Bearer sk-test-key", gotAuth)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
}

// TestMorphAPICapabilities pins the derived capability flags: the recurring
// (usage) and one-time (balance) paths plus the generic models endpoint.
func TestMorphAPICapabilities(t *testing.T) {
	provider, ok := ProviderByID("morphapi")
	if !ok {
		t.Fatal("morphapi missing from registry")
	}
	if !SupportsUsageQuery("morphapi") {
		t.Error("SupportsUsageQuery(morphapi) = false, want true")
	}
	if !SupportsBalanceQuery("morphapi") {
		t.Error("SupportsBalanceQuery(morphapi) = false, want true")
	}
	if !SupportsModelsQuery(provider) {
		t.Error("SupportsModelsQuery(morphapi) = false, want true")
	}
	if got := ResolveUsageAPIURL(provider, ""); got != morphapiUsageURL {
		t.Errorf("ResolveUsageAPIURL = %q, want %q", got, morphapiUsageURL)
	}
	if provider.BalanceAPIURL != morphapiUsageURL {
		t.Errorf("BalanceAPIURL = %q, want %q", provider.BalanceAPIURL, morphapiUsageURL)
	}
}
