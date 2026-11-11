package providers

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// TestFastAIUsageHandler pins the额度 handler against the real response shape
// of GET https://www.fastaitoken.com/v1/usage and the ccswitch usageScript
// extractor contract:
//
//	remaining = remaining ?? quota?.remaining ?? balance
//	unit      = unit      ?? quota?.unit      ?? "USD"
//	isValid   = is_active ?? isValid          ?? true
//
// A live probe (overdrawn account) returned the flat payload used in the first
// case below. Deliberately no balance_infos / data[] branching: that shape
// belongs to dddai, not FastAI.
func TestFastAIUsageHandler(t *testing.T) {
	t.Run("real probe payload maps remaining into Monthly window", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"balance":-0.02009565,"daily_usage":[],"isValid":true,"mode":"unrestricted","planName":"钱包余额","remaining":-0.02009565,"unit":"USD","usage":{"total":{"actual_cost":10.02009565,"cost":40.0803826}}}`}

		result, err := FetchFastAIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIUsage: %v", err)
		}
		if result.Provider != "fastai" {
			t.Errorf("provider = %q, want fastai", result.Provider)
		}
		if result.Monthly == nil {
			t.Fatal("Monthly = nil, want non-nil")
		}
		if result.Monthly.Remaining != "-0.02" {
			t.Errorf("Monthly.Remaining = %q, want -0.02", result.Monthly.Remaining)
		}
		if result.Monthly.Limit != "-0.02" {
			t.Errorf("Monthly.Limit = %q, want -0.02", result.Monthly.Limit)
		}
		if result.Monthly.Used != "0.00" {
			t.Errorf("Monthly.Used = %q, want 0.00", result.Monthly.Used)
		}
		if result.FiveHour != nil || result.Weekly != nil {
			t.Errorf("5h/weekly should be nil for a wallet relay: %+v / %+v", result.FiveHour, result.Weekly)
		}
		wantWarnings := []string{"钱包余额 · USD", "模式: unrestricted", "累计消耗: 10.02 USD"}
		assertStrings(t, result.Warnings, wantWarnings)
	})

	t.Run("remaining wins over quota.remaining and balance (?? chain)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":12.5,"quota":{"remaining":99,"unit":"CNY"},"balance":88,"unit":"USD"}`}

		result, err := FetchFastAIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIUsage: %v", err)
		}
		if result.Monthly.Remaining != "12.50" {
			t.Errorf("Monthly.Remaining = %q, want 12.50", result.Monthly.Remaining)
		}
		if len(result.Warnings) == 0 || result.Warnings[0] != "余额 · USD" {
			t.Errorf("Warnings[0] = %v, want 余额 · USD", result.Warnings)
		}
	})

	t.Run("quota.remaining / quota.unit used when top-level absent", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"quota":{"remaining":7,"unit":"CNY"},"balance":3}`}

		result, err := FetchFastAIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIUsage: %v", err)
		}
		if result.Monthly.Remaining != "7.00" {
			t.Errorf("Monthly.Remaining = %q, want 7.00", result.Monthly.Remaining)
		}
		if len(result.Warnings) == 0 || result.Warnings[0] != "余额 · CNY" {
			t.Errorf("Warnings[0] = %v, want 余额 · CNY", result.Warnings)
		}
	})

	t.Run("balance and USD defaults when only balance is present", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"balance":25}`}

		result, err := FetchFastAIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIUsage: %v", err)
		}
		if result.Monthly.Remaining != "25.00" {
			t.Errorf("Monthly.Remaining = %q, want 25.00", result.Monthly.Remaining)
		}
		if len(result.Warnings) == 0 || result.Warnings[0] != "余额 · USD" {
			t.Errorf("Warnings[0] = %v, want 余额 · USD", result.Warnings)
		}
	})

	t.Run("explicit remaining: 0 is not skipped by ?? (differs from ||)", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"remaining":0,"balance":42}`}

		result, err := FetchFastAIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIUsage: %v", err)
		}
		if result.Monthly.Remaining != "0.00" {
			t.Errorf("Monthly.Remaining = %q, want 0.00", result.Monthly.Remaining)
		}
	})

	t.Run("is_active: false surfaces an invalid-account warning", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"is_active":false,"isValid":true,"remaining":5,"unit":"USD"}`}

		result, err := FetchFastAIUsage(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchFastAIUsage: %v", err)
		}
		if !containsString(result.Warnings, "账户状态: 无效") {
			t.Errorf("Warnings = %v, want an invalid-account line", result.Warnings)
		}
	})

	t.Run("API error surfaces status code", func(t *testing.T) {
		_, err := FetchFastAIUsage(context.Background(), cannedHTTPDoer{statusCode: http.StatusUnauthorized, body: "Unauthorized"}, "k")
		if err == nil || !strings.Contains(err.Error(), "FastAI API returned 401") {
			t.Errorf("err = %v, want FastAI API returned 401", err)
		}
	})
}

// TestFastAIBalanceHandler covers the one-time subscription path. It shares
// the same parse helper, so the extractor contract stays identical for both
// subscription types.
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

	if _, err := FetchFastAIUsage(context.Background(), client, "sk-test-key"); err != nil {
		t.Fatalf("FetchFastAIUsage: %v", err)
	}
	if gotURL != fastaiUsageURL {
		t.Errorf("url = %q, want %q", gotURL, fastaiUsageURL)
	}
	if gotAuth != "Bearer sk-test-key" {
		t.Errorf("Authorization = %q, want Bearer sk-test-key", gotAuth)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
}
