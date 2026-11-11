package providers

import (
	"context"
	"fmt"
)

// --- FastAI (https://www.fastaitoken.com) 额度查询 ---
//
// The ccswitch import contract (usageScript) defines GET {baseUrl}/v1/usage
// with a Bearer apiKey and an extractor over a flat payload:
//
//	remaining = response.remaining ?? response.quota?.remaining ?? response.balance
//	unit      = response.unit      ?? response.quota?.unit      ?? "USD"
//	isValid   = response.is_active ?? response.isValid          ?? true
//
// A live probe of the endpoint returned (key redacted; this account is
// overdrawn, hence the negative remaining):
//
//	{"balance":-0.02009565,"daily_usage":[],"isValid":true,
//	 "mode":"unrestricted","planName":"钱包余额","remaining":-0.02009565,
//	 "unit":"USD","usage":{"total":{"actual_cost":10.02009565,"cost":40.08,...}}}
//
// Unlike dddai there is no balance_infos / data[] array to branch on: the
// nullish-coalescing chain above is the whole contract. Both the recurring
// (usage) and one-time (balance) queries share this single fetch/parse helper
// so the two handlers cannot drift apart.

const fastaiUsageURL = "https://www.fastaitoken.com/v1/usage"

// fastaiQuota is the normalized额度 payload from GET /v1/usage.
type fastaiQuota struct {
	remaining float64
	unit      string
	planName  string
	mode      string
	isValid   bool
	used      float64 // cumulative actual_cost, when the API reports it
	hasUsed   bool
}

// fastaiFirstPresent mirrors JS `a ?? b ?? c`: a missing or JSON-null value
// falls through, while any other value (including false / 0 / "") stops the
// chain. That distinction matters for `is_active: false` and `remaining: 0`.
func fastaiFirstPresent(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// parseFastAIQuota implements the ccswitch extractor over a decoded response.
func parseFastAIQuota(data map[string]any) fastaiQuota {
	quota, _ := data["quota"].(map[string]any)

	q := fastaiQuota{}
	q.remaining = numberOrZero(fastaiFirstPresent(data["remaining"], quota["remaining"], data["balance"]))

	if unit := fastaiFirstPresent(data["unit"], quota["unit"]); unit != nil {
		q.unit, _ = unit.(string)
	}
	if q.unit == "" {
		q.unit = "USD"
	}

	// `?? true` means an absent value defaults to valid, but an explicit
	// false (is_active / isValid) must survive — hence the nil check, not
	// jsTruthy on the whole chain.
	q.isValid = true
	if valid := fastaiFirstPresent(data["is_active"], data["isValid"]); valid != nil {
		q.isValid = jsTruthy(valid)
	}

	q.planName, _ = data["planName"].(string)
	if q.planName == "" {
		q.planName = "余额"
	}
	q.mode, _ = data["mode"].(string)

	if usage, ok := data["usage"].(map[string]any); ok {
		if total, ok := usage["total"].(map[string]any); ok {
			if used, ok := jsNumber(total["actual_cost"]); ok {
				q.used, q.hasUsed = used, true
			}
		}
	}
	return q
}

// fetchFastAIQuota issues the额度 request shared by both FastAI handlers.
func fetchFastAIQuota(ctx context.Context, client HTTPDoer, apiKey string) (fastaiQuota, error) {
	response, err := doGET(ctx, client, fastaiUsageURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return fastaiQuota{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return fastaiQuota{}, fmt.Errorf("FastAI API returned %d", response.StatusCode)
	}
	data, err := decodeObject(response)
	if err != nil {
		return fastaiQuota{}, err
	}
	return parseFastAIQuota(data), nil
}

// fastaiWarnings carries额度 metadata the UsageWindow/BalanceInfo fields have
// no slot for, following the dddai precedent of surfacing plan labels as
// warnings (kept on the wire for richer clients).
func fastaiWarnings(q fastaiQuota) []string {
	warnings := []string{q.planName + " · " + q.unit}
	if q.mode != "" {
		warnings = append(warnings, "模式: "+q.mode)
	}
	if q.hasUsed {
		warnings = append(warnings, "累计消耗: "+toFixed2(q.used)+" "+q.unit)
	}
	if !q.isValid {
		warnings = append(warnings, "账户状态: 无效")
	}
	return warnings
}

// --- recurring subscriptions (usage query) ---

type fastaiUsageHandler struct{ client HTTPDoer }

func (h *fastaiUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	q, err := fetchFastAIQuota(ctx, h.client, credentials["apiKey"])
	if err != nil {
		return UsageResult{}, err
	}

	// A relay wallet has no 5-hour/weekly/monthly window, so — as with dddai —
	// the额度 rides in a single Monthly window: limit and remaining are the
	// available额度, used is zero. Cumulative spend is reported in warnings
	// rather than folded into a fabricated window limit, because the API only
	// exposes lifetime consumption, not a per-window one.
	amount := toFixed2(q.remaining)
	zero := "0.00"
	return UsageResult{
		Provider: "fastai",
		Monthly: &UsageWindow{
			Limit:     amount,
			Used:      zero,
			Remaining: amount,
		},
		Warnings: fastaiWarnings(q),
	}, nil
}

func (h *fastaiUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, fastaiUsageURL, credentials["apiKey"])
}

// FetchFastAIUsage is the exported entry point mirroring FetchDDDaiUsage: it
// fetches and normalizes the额度 payload into a UsageResult.
func FetchFastAIUsage(ctx context.Context, client HTTPDoer, apiKey string) (UsageResult, error) {
	return (&fastaiUsageHandler{client: client}).FetchUsage(ctx, map[string]string{"apiKey": apiKey})
}

// --- one-time subscriptions (balance query) ---

type fastaiBalanceHandler struct{ client HTTPDoer }

func (h *fastaiBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	q, err := fetchFastAIQuota(ctx, h.client, credentials["apiKey"])
	if err != nil {
		return BalanceResult{}, err
	}
	planName := q.planName
	return BalanceResult{
		Provider:    "fastai",
		IsAvailable: q.isValid,
		BalanceInfos: []BalanceInfo{{
			Currency:  q.unit,
			Available: toFixed2(q.remaining),
			Total:     &planName,
		}},
	}, nil
}

func (h *fastaiBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, fastaiUsageURL, credentials["apiKey"])
}

// FetchFastAIBalance is the exported entry point mirroring FetchDDDaiBalance.
func FetchFastAIBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	return (&fastaiBalanceHandler{client: client}).FetchBalance(ctx, map[string]string{"apiKey": apiKey})
}

var (
	_ UsageHandler   = (*fastaiUsageHandler)(nil)
	_ BalanceHandler = (*fastaiBalanceHandler)(nil)
)
