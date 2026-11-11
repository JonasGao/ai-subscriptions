package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// --- MorphAPI (https://www.aidjapi.top) 额度查询 ---
//
// MorphAPI is an OpenAI-compatible (new-api / one-api class) relay panel. Its
// ccswitch usageScript contract is:
//
//	GET {baseUrl}/v1/usage        (baseUrl has trailing "/" and "/v1" stripped)
//	Authorization: Bearer <API_KEY>
//
// The额度 payload is normalized by the shared ccswitch extractor in
// coalescing.go (remaining ?? quota.remaining ?? balance, etc.). See that file
// for the `??` semantics.
//
// A live probe documented in the handoff showed the panel's non-2xx body is a
// JSON object rather than plain text, e.g.
//
//	HTTP 403 {"code":"GROUP_DELETED","message":"API Key 所属分组已删除"}
//
// so decodedRelayError surfaces that message instead of a bare status code.
// The backend guard chain maps a handler error to a 502 with this text.

const morphapiUsageURL = "https://www.aidjapi.top/v1/usage"

// fetchMorphAPIQuota issues the额度 request shared by both MorphAPI handlers so
// the recurring (usage) and one-time (balance) queries cannot drift apart.
func fetchMorphAPIQuota(ctx context.Context, client HTTPDoer, apiKey string) (relayQuota, error) {
	response, err := doGET(ctx, client, morphapiUsageURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return relayQuota{}, err
	}
	if !isSuccess(response) {
		status := response.StatusCode
		message := decodeRelayError(response)
		response.Body.Close()
		return relayQuota{}, fmt.Errorf("MorphAPI API returned %d: %s", status, message)
	}
	data, err := decodeObject(response)
	if err != nil {
		return relayQuota{}, err
	}
	return parseRelayQuota(data), nil
}

// decodeRelayError turns a non-2xx relay-panel body into a readable message.
// new-api/one-api panels return {"code":...,"message":...}; anything else (or
// an empty/unreadable body) falls back to the HTTP status text.
func decodeRelayError(response *http.Response) string {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	var payload struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		message := strings.TrimSpace(payload.Message)
		if message != "" {
			if code := strings.TrimSpace(payload.Code); code != "" {
				return fmt.Sprintf("%s (%s)", message, code)
			}
			return message
		}
	}
	if text := strings.TrimSpace(string(body)); text != "" {
		return text
	}
	return strings.TrimSpace(strings.TrimPrefix(response.Status, fmt.Sprintf("%d ", response.StatusCode)))
}

// morphapiWarnings carries额度 metadata that UsageWindow has no slot for,
// following the dddai/fastai precedent of surfacing plan labels as warnings.
func morphapiWarnings(q relayQuota) []string {
	warnings := []string{q.planName + " · " + q.unit}
	if !q.isValid {
		warnings = append(warnings, "账户状态: 无效")
	}
	return warnings
}

// --- recurring subscriptions (usage query) ---

type morphapiUsageHandler struct{ client HTTPDoer }

func (h *morphapiUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	q, err := fetchMorphAPIQuota(ctx, h.client, credentials["apiKey"])
	if err != nil {
		return UsageResult{}, err
	}

	// A relay wallet has no 5-hour/weekly/monthly window. As with dddai/fastai,
	// the额度 rides in a single Monthly window: limit and remaining are the
	// available额度, used is zero. The panel does not expose per-window spend,
	// so fabricating a used value would be misleading.
	amount := toFixed2(q.remaining)
	zero := "0.00"
	return UsageResult{
		Provider: "morphapi",
		Monthly: &UsageWindow{
			Limit:     amount,
			Used:      zero,
			Remaining: amount,
		},
		Warnings: morphapiWarnings(q),
	}, nil
}

func (h *morphapiUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, morphapiUsageURL, credentials["apiKey"])
}

// FetchMorphAPIUsage is the exported entry point for the recurring path.
func FetchMorphAPIUsage(ctx context.Context, client HTTPDoer, apiKey string) (UsageResult, error) {
	return (&morphapiUsageHandler{client: client}).FetchUsage(ctx, map[string]string{"apiKey": apiKey})
}

// --- one-time subscriptions (balance query) ---

type morphapiBalanceHandler struct{ client HTTPDoer }

func (h *morphapiBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	q, err := fetchMorphAPIQuota(ctx, h.client, credentials["apiKey"])
	if err != nil {
		return BalanceResult{}, err
	}
	amount := toFixed2(q.remaining)
	return BalanceResult{
		Provider:    "morphapi",
		IsAvailable: q.isValid,
		BalanceInfos: []BalanceInfo{{
			Currency:  q.unit,
			Available: amount,
			// A relay wallet reports only its remaining quota, not a top-up
			// total. Reflect that amount as 总额度 (a numeric balance) instead
			// of the plan-name string, which formatBalance coerces to 0.
			Total: &amount,
		}},
	}, nil
}

func (h *morphapiBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, morphapiUsageURL, credentials["apiKey"])
}

// FetchMorphAPIBalance is the exported entry point for the one-time path.
func FetchMorphAPIBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	return (&morphapiBalanceHandler{client: client}).FetchBalance(ctx, map[string]string{"apiKey": apiKey})
}

var (
	_ UsageHandler   = (*morphapiUsageHandler)(nil)
	_ BalanceHandler = (*morphapiBalanceHandler)(nil)
)
