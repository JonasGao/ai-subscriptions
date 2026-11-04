package providers

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/balance-handlers.test.ts (5 cases): the four balance
// providers normalise their payloads into one BalanceResult shape.
//
// Deviation from the old stack: the old tests stubbed global fetch; here the
// handler takes an injected HTTPDoer (see providers_test.go). Subtest names keep
// the old describe/it text so the parity matrix maps case by case.

func TestBalanceHandlerUnification(t *testing.T) {
	t.Run("moonshot: maps to available/granted/toppedUp with currency=CNY", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"status":true,"data":{"available_balance":399.5,"voucher_balance":50,"cash_balance":349.5}}`}

		result, err := FetchMoonshotBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchMoonshotBalance: %v", err)
		}
		if result.Provider != "moonshot" {
			t.Errorf("provider = %q, want moonshot", result.Provider)
		}
		if !result.IsAvailable {
			t.Error("isAvailable = false, want true")
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		info := result.BalanceInfos[0]
		if info.Currency != "CNY" {
			t.Errorf("currency = %q, want CNY", info.Currency)
		}
		if info.Available != "399.50" {
			t.Errorf("available = %q, want 399.50", info.Available)
		}
		assertPtr(t, "granted", info.Granted, "50.00")
		assertPtr(t, "toppedUp", info.ToppedUp, "349.50")
		assertNilPtr(t, "total", info.Total)
		assertNilPtr(t, "used", info.Used)
		assertNilPtr(t, "frozen", info.Frozen)
	})

	t.Run("deepseek: maps to available/toppedUp/granted with currency from API", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"42.50","granted_balance":"10.00","topped_up_balance":"32.50"}]}`}

		result, err := FetchDeepSeekBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchDeepSeekBalance: %v", err)
		}
		if result.Provider != "deepseek" {
			t.Errorf("provider = %q, want deepseek", result.Provider)
		}
		if !result.IsAvailable {
			t.Error("isAvailable = false, want true")
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		info := result.BalanceInfos[0]
		if info.Currency != "USD" || info.Available != "42.50" {
			t.Errorf("info = (%q, %q), want (USD, 42.50)", info.Currency, info.Available)
		}
		assertPtr(t, "granted", info.Granted, "10.00")
		assertPtr(t, "toppedUp", info.ToppedUp, "32.50")
		assertNilPtr(t, "total", info.Total)
		assertNilPtr(t, "used", info.Used)
	})

	t.Run("deepseek: falls back to USD when currency is missing", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"is_available":true,"balance_infos":[{"total_balance":"10","granted_balance":"0","topped_up_balance":"10"}]}`}

		result, err := FetchDeepSeekBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchDeepSeekBalance: %v", err)
		}
		if len(result.BalanceInfos) != 1 || result.BalanceInfos[0].Currency != "USD" {
			t.Errorf("currency = %+v, want USD", result.BalanceInfos)
		}
	})

	t.Run("siliconflow (semantics fixed): maps available=totalBalance, granted=balance, toppedUp=chargeBalance", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"code":20000,"status":"normal","data":{"totalBalance":"500.00","balance":"300.00","chargeBalance":"200.00","status":"normal"}}`}

		result, err := FetchSiliconFlowBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchSiliconFlowBalance: %v", err)
		}
		if result.Provider != "siliconflow" {
			t.Errorf("provider = %q, want siliconflow", result.Provider)
		}
		if !result.IsAvailable {
			t.Error("isAvailable = false, want true")
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		info := result.BalanceInfos[0]
		if info.Currency != "CNY" {
			t.Errorf("currency = %q, want CNY", info.Currency)
		}
		// available = totalBalance (total usable balance, persisted to
		// Subscription.balance)
		if info.Available != "500.00" {
			t.Errorf("available = %q, want 500.00", info.Available)
		}
		// granted = balance (voucher portion); toppedUp = chargeBalance (cash)
		assertPtr(t, "granted", info.Granted, "300.00")
		assertPtr(t, "toppedUp", info.ToppedUp, "200.00")
		// total = null (avoids duplicate display with available)
		assertNilPtr(t, "total", info.Total)
		assertNilPtr(t, "used", info.Used)
	})

	t.Run("openrouter (semantics fixed): maps available=credits-usage, total=credits, used=usage", func(t *testing.T) {
		client := cannedHTTPDoer{body: `{"data":{"total_credits":100,"total_usage":25}}`}

		result, err := FetchOpenRouterBalance(context.Background(), client, "test-key")
		if err != nil {
			t.Fatalf("FetchOpenRouterBalance: %v", err)
		}
		if result.Provider != "openrouter" {
			t.Errorf("provider = %q, want openrouter", result.Provider)
		}
		if !result.IsAvailable {
			t.Error("isAvailable = false, want true")
		}
		if len(result.BalanceInfos) != 1 {
			t.Fatalf("balanceInfos length = %d, want 1", len(result.BalanceInfos))
		}
		info := result.BalanceInfos[0]
		if info.Currency != "USD" {
			t.Errorf("currency = %q, want USD", info.Currency)
		}
		// Semantic fix: available is remaining credits, not total_usage
		if info.Available != "75.00" {
			t.Errorf("available = %q, want 75.00", info.Available)
		}
		assertPtr(t, "total", info.Total, "100.00")
		assertPtr(t, "used", info.Used, "25.00")
		assertNilPtr(t, "toppedUp", info.ToppedUp)
		assertNilPtr(t, "granted", info.Granted)
	})
}

// Supplementary guards (not parity cases): the four error paths the old
// handlers implemented and the route surfaces as 502.
func TestBalanceHandlerErrors(t *testing.T) {
	t.Run("moonshot rejects a payload without available_balance", func(t *testing.T) {
		_, err := FetchMoonshotBalance(context.Background(), cannedHTTPDoer{body: `{"status":true,"data":{}}`}, "k")
		if err == nil || !strings.Contains(err.Error(), "Unexpected Moonshot API response format") {
			t.Errorf("err = %v, want unexpected-format", err)
		}
	})

	t.Run("deepseek reports the upstream status", func(t *testing.T) {
		_, err := FetchDeepSeekBalance(context.Background(), cannedHTTPDoer{statusCode: http.StatusUnauthorized, body: "Unauthorized"}, "k")
		if err == nil || !strings.Contains(err.Error(), "DeepSeek API returned 401") {
			t.Errorf("err = %v, want DeepSeek API returned 401", err)
		}
	})

	t.Run("siliconflow rejects a non-20000 envelope using the API message", func(t *testing.T) {
		_, err := FetchSiliconFlowBalance(context.Background(), cannedHTTPDoer{body: `{"code":20001,"message":"invalid token"}`}, "k")
		if err == nil || !strings.Contains(err.Error(), "invalid token") {
			t.Errorf("err = %v, want invalid token", err)
		}
	})

	t.Run("openrouter rejects a payload without credit numbers", func(t *testing.T) {
		_, err := FetchOpenRouterBalance(context.Background(), cannedHTTPDoer{body: `{"data":{}}`}, "k")
		if err == nil || !strings.Contains(err.Error(), "Unexpected OpenRouter API response format") {
			t.Errorf("err = %v, want unexpected-format", err)
		}
	})
}

// Supplementary guard: the registry keys are the four providers the old stack
// registered, and every one of them resolves to a working handler.
func TestBalanceHandlersRegistration(t *testing.T) {
	handlers := BalanceHandlers(cannedHTTPDoer{body: `{"status":true,"data":{"available_balance":1}}`})
	if len(handlers) != 4 {
		t.Fatalf("registered handlers = %d, want 4", len(handlers))
	}
	for _, key := range []string{"moonshot", "deepseek", "siliconflow", "openrouter"} {
		if handlers[key] == nil {
			t.Errorf("balanceHandlers[%q] is nil", key)
		}
	}

	// The old registry has no plan-level balance keys; adding one would change
	// the supportsBalanceQuery capability flag.
	for _, key := range []string{"alibaba", "fangzhou", "github", "opencode", "zhipu"} {
		if handlers[key] != nil {
			t.Errorf("balanceHandlers[%q] = %v, want nil", key, handlers[key])
		}
	}
}

func assertPtr(t *testing.T, label string, got *string, want string) {
	t.Helper()
	if got == nil {
		t.Errorf("%s = nil, want %q", label, want)
		return
	}
	if *got != want {
		t.Errorf("%s = %q, want %q", label, *got, want)
	}
}

func assertNilPtr(t *testing.T, label string, got *string) {
	t.Helper()
	if got != nil {
		t.Errorf("%s = %q, want null", label, *got)
	}
}
