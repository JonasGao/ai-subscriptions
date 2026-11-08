package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// BalanceInfo is one currency line of a balance query result
// (lib/types.ts BalanceInfo). Optional amounts are nil so they serialise as
// JSON null, which the frontend uses to decide which rows to render.
type BalanceInfo struct {
	Currency  string  `json:"currency"`
	Available string  `json:"available"`
	Total     *string `json:"total"`
	ToppedUp  *string `json:"toppedUp"`
	Granted   *string `json:"granted"`
	Used      *string `json:"used"`
	Frozen    *string `json:"frozen"`
}

// BalanceResult is the normalized balance query result (lib/types.ts
// BalanceResult).
type BalanceResult struct {
	Provider     string        `json:"provider"`
	IsAvailable  bool          `json:"isAvailable"`
	BalanceInfos []BalanceInfo `json:"balanceInfos"`
}

// BalanceHandler is the balance-query contract for a provider. Unlike the usage
// contract there is no plan level: balance is a provider-wide concept
// (lib/providers/index.ts balanceHandlers).
type BalanceHandler interface {
	FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error)
	TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error)
}

// BalanceHandlers returns the implemented balance handlers, mirroring
// lib/providers/index.ts balanceHandlers: bare provider keys only.
func BalanceHandlers(clients ...HTTPDoer) map[string]BalanceHandler {
	client := resolveClient(clients)
	return map[string]BalanceHandler{
		"moonshot":    &moonshotBalanceHandler{client: client},
		"deepseek":    &deepseekBalanceHandler{client: client},
		"siliconflow": &siliconFlowBalanceHandler{client: client},
		"openrouter":  &openRouterBalanceHandler{client: client},
		"dddai":       &dddaiBalanceHandler{client: client},
	}
}

// doGET issues a GET with the given headers through the injected client. The
// old stack funnelled every provider call through fetchWithTimeout, whose
// request timeout lives on the client here (DefaultHTTPClient: 10s).
func doGET(ctx context.Context, client HTTPDoer, url string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return client.Do(req)
}

// decodeObject decodes a JSON object body, the shape every provider endpoint
// returns.
func decodeObject(response *http.Response) (map[string]any, error) {
	defer response.Body.Close()
	var data map[string]any
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func isSuccess(response *http.Response) bool {
	return response.StatusCode >= 200 && response.StatusCode < 300
}

// jsTruthy applies JS truthiness to a decoded JSON value, matching the old
// stack's `data.status && …` style guards.
func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	default:
		return true
	}
}

// toFixed2 renders a float the way Number.prototype.toFixed(2) does for the
// finite values these APIs return.
func toFixed2(f float64) string {
	return strconv.FormatFloat(f, 'f', 2, 64)
}

// numberOrZero is parseFloat(v) with the old stack's `Number.isFinite(n) ? n : 0`
// fallback.
func numberOrZero(v any) float64 {
	if f, ok := jsNumber(v); ok {
		return f
	}
	return 0
}

func strPtr(value string) *string { return &value }

// --- Moonshot (lib/providers/moonshot.ts fetchMoonshotBalance) ---

const moonshotBalanceURL = "https://api.moonshot.cn/v1/users/me/balance"

type moonshotBalanceHandler struct{ client HTTPDoer }

func (h *moonshotBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	return FetchMoonshotBalance(ctx, h.client, credentials["apiKey"])
}

func (h *moonshotBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, moonshotBalanceURL, credentials["apiKey"])
}

// FetchMoonshotBalance ports fetchMoonshotBalance. available/granted/toppedUp
// map to available_balance / voucher_balance / cash_balance.
func FetchMoonshotBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	response, err := doGET(ctx, client, moonshotBalanceURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return BalanceResult{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return BalanceResult{}, fmt.Errorf("Moonshot API returned %d", response.StatusCode)
	}

	data, err := decodeObject(response)
	if err != nil {
		return BalanceResult{}, err
	}

	detail, _ := data["data"].(map[string]any)
	availableBalance, hasAvailable := jsNumber(detail["available_balance"])
	if !hasAvailable {
		return BalanceResult{}, fmt.Errorf("Unexpected Moonshot API response format")
	}

	return BalanceResult{
		Provider:    "moonshot",
		IsAvailable: jsTruthy(data["status"]) && availableBalance > 0,
		BalanceInfos: []BalanceInfo{{
			Currency:  "CNY",
			Available: toFixed2(availableBalance),
			ToppedUp:  strPtr(toFixed2(numberOrZero(detail["cash_balance"]))),
			Granted:   strPtr(toFixed2(numberOrZero(detail["voucher_balance"]))),
		}},
	}, nil
}

// --- DeepSeek (lib/providers/deepseek.ts fetchDeepSeekBalance) ---

const deepSeekBalanceURL = "https://api.deepseek.com/user/balance"

type deepseekBalanceHandler struct{ client HTTPDoer }

func (h *deepseekBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	return FetchDeepSeekBalance(ctx, h.client, credentials["apiKey"])
}

func (h *deepseekBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, deepSeekBalanceURL, credentials["apiKey"])
}

// FetchDeepSeekBalance ports fetchDeepSeekBalance. Currency falls back to USD
// when the API omits it.
func FetchDeepSeekBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	response, err := doGET(ctx, client, deepSeekBalanceURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return BalanceResult{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return BalanceResult{}, fmt.Errorf("DeepSeek API returned %d", response.StatusCode)
	}

	data, err := decodeObject(response)
	if err != nil {
		return BalanceResult{}, err
	}

	infos := []BalanceInfo{}
	rawInfos, _ := data["balance_infos"].([]any)
	for _, raw := range rawInfos {
		info, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		currency, _ := info["currency"].(string)
		if currency == "" {
			currency = "USD"
		}
		infos = append(infos, BalanceInfo{
			Currency:  currency,
			Available: toFixed2(numberOrZero(info["total_balance"])),
			ToppedUp:  strPtr(toFixed2(numberOrZero(info["topped_up_balance"]))),
			Granted:   strPtr(toFixed2(numberOrZero(info["granted_balance"]))),
		})
	}

	return BalanceResult{
		Provider:     "deepseek",
		IsAvailable:  jsTruthy(data["is_available"]),
		BalanceInfos: infos,
	}, nil
}

// --- SiliconFlow (lib/providers/siliconflow.ts fetchSiliconFlowBalance) ---

const siliconFlowInfoURL = "https://api.siliconflow.cn/v1/user/info"

type siliconFlowBalanceHandler struct{ client HTTPDoer }

func (h *siliconFlowBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	return FetchSiliconFlowBalance(ctx, h.client, credentials["apiKey"])
}

func (h *siliconFlowBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	response, err := doGET(ctx, h.client, siliconFlowInfoURL, map[string]string{
		"Authorization": "Bearer " + credentials["apiKey"],
	})
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	if !isSuccess(response) {
		response.Body.Close()
		return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", response.StatusCode)}, nil
	}
	data, err := decodeObject(response)
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	if code, _ := jsNumber(data["code"]); code == 20000 && jsTruthy(data["status"]) {
		return ConnectionResult{OK: true, Message: "连接成功"}, nil
	}
	if message, ok := data["message"].(string); ok && message != "" {
		return ConnectionResult{OK: false, Message: message}, nil
	}
	return ConnectionResult{OK: false, Message: "API 返回错误"}, nil
}

// FetchSiliconFlowBalance ports fetchSiliconFlowBalance: totalBalance is the
// usable balance, balance the granted portion, chargeBalance the cash top-up.
func FetchSiliconFlowBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	response, err := doGET(ctx, client, siliconFlowInfoURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return BalanceResult{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return BalanceResult{}, fmt.Errorf("SiliconFlow API returned %d", response.StatusCode)
	}

	data, err := decodeObject(response)
	if err != nil {
		return BalanceResult{}, err
	}

	if code, _ := jsNumber(data["code"]); code != 20000 || !jsTruthy(data["status"]) {
		if message, ok := data["message"].(string); ok && message != "" {
			return BalanceResult{}, fmt.Errorf("%s", message)
		}
		return BalanceResult{}, fmt.Errorf("SiliconFlow API error")
	}

	detail, _ := data["data"].(map[string]any)
	totalBalance := detail["totalBalance"]
	status := detail["status"]
	if !jsTruthy(totalBalance) || !jsTruthy(status) {
		return BalanceResult{}, fmt.Errorf("Unexpected SiliconFlow API response format")
	}

	total := numberOrZero(totalBalance)
	statusText, _ := status.(string)
	return BalanceResult{
		Provider:    "siliconflow",
		IsAvailable: statusText == "normal" && total > 0,
		BalanceInfos: []BalanceInfo{{
			Currency:  "CNY",
			Available: toFixed2(total),
			ToppedUp:  strPtr(toFixed2(numberOrZero(detail["chargeBalance"]))),
			Granted:   strPtr(toFixed2(numberOrZero(detail["balance"]))),
		}},
	}, nil
}

// --- OpenRouter (lib/providers/openrouter.ts fetchOpenRouterBalance) ---

const openRouterCreditsURL = "https://openrouter.ai/api/v1/credits"

type openRouterBalanceHandler struct{ client HTTPDoer }

func (h *openRouterBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	return FetchOpenRouterBalance(ctx, h.client, credentials["apiKey"])
}

func (h *openRouterBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, openRouterCreditsURL, credentials["apiKey"])
}

// FetchOpenRouterBalance ports fetchOpenRouterBalance: available is the
// remaining credits, total the purchased amount, used the consumed amount.
func FetchOpenRouterBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	response, err := doGET(ctx, client, openRouterCreditsURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return BalanceResult{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return BalanceResult{}, fmt.Errorf("OpenRouter API returned %d", response.StatusCode)
	}

	data, err := decodeObject(response)
	if err != nil {
		return BalanceResult{}, err
	}

	detail, _ := data["data"].(map[string]any)
	totalCredits, hasCredits := jsNumber(detail["total_credits"])
	totalUsage, hasUsage := jsNumber(detail["total_usage"])
	if !hasCredits || !hasUsage {
		return BalanceResult{}, fmt.Errorf("Unexpected OpenRouter API response format")
	}

	remaining := totalCredits - totalUsage
	return BalanceResult{
		Provider:    "openrouter",
		IsAvailable: remaining > 0,
		BalanceInfos: []BalanceInfo{{
			Currency:  "USD",
			Available: toFixed2(remaining),
			Total:     strPtr(toFixed2(totalCredits)),
			Used:      strPtr(toFixed2(totalUsage)),
		}},
	}, nil
}

// --- 滴滴滴AI (OpenAI-compatible relay) ---
//
// The balance endpoint (GET /user/balance) returns one of two shapes:
//
//  1. DeepSeek-like: {"is_available":true,"balance_infos":[{...}]}
//     In this case data["balance_infos"] is a non-empty array and each item
//     has currency + total_balance + topped_up + granted.
//
//  2. Flat relay: {"is_active":true,"isValid":true,"planName":"余额",
//     "balance":100,"unit":"USD"}
//     balance or remaining is the available amount; is_active/is_valid drive
//     IsAvailable; unit falls back to USD.
const dddaiBalanceURL = "https://api.dddai.dev/user/balance"

type dddaiBalanceHandler struct{ client HTTPDoer }

func (h *dddaiBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	return FetchDDDaiBalance(ctx, h.client, credentials["apiKey"])
}

func (h *dddaiBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, dddaiBalanceURL, credentials["apiKey"])
}

// FetchDDDaiBalance queries the 滴滴滴AI balance endpoint.
// The response format is flexible: if the API returns balance_infos (DeepSeek
// style), those items are used directly; otherwise the top-level balance /
// remaining fields drive a single balance line.
func FetchDDDaiBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	response, err := doGET(ctx, client, dddaiBalanceURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return BalanceResult{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return BalanceResult{}, fmt.Errorf("DDDai API returned %d", response.StatusCode)
	}

	data, err := decodeObject(response)
	if err != nil {
		return BalanceResult{}, err
	}

	// Shape 1: DeepSeek-compatible balance_infos array.
	if rawInfos, ok := data["balance_infos"].([]any); ok && len(rawInfos) > 0 {
		infos := make([]BalanceInfo, 0, len(rawInfos))
		for _, raw := range rawInfos {
			info, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			currency, _ := info["currency"].(string)
			if currency == "" {
				currency = "USD"
			}
			infos = append(infos, BalanceInfo{
				Currency:  currency,
				Available: toFixed2(numberOrZero(info["total_balance"])),
				ToppedUp:  strPtr(toFixed2(numberOrZero(info["topped_up_balance"]))),
				Granted:   strPtr(toFixed2(numberOrZero(info["granted_balance"]))),
			})
		}
		return BalanceResult{
			Provider:     "dddai",
			IsAvailable:  jsTruthy(data["is_available"]),
			BalanceInfos: infos,
		}, nil
	}

	// Shape 2: flat relay payload.
	isAvailable := data["is_active"] != false && data["isValid"] != false
	remaining := numberOrZero(data["balance"])
	if _, hasBalance := jsNumber(data["balance"]); !hasBalance {
		remaining = numberOrZero(data["remaining"])
	}
	currency, _ := data["unit"].(string)
	if currency == "" {
		currency = "USD"
	}
	planName, _ := data["planName"].(string)
	if planName == "" {
		planName = "余额"
	}

	return BalanceResult{
		Provider:    "dddai",
		IsAvailable: isAvailable,
		BalanceInfos: []BalanceInfo{{
			Currency:  currency,
			Available: toFixed2(remaining),
			Total:     &planName,
		}},
	}, nil
}
