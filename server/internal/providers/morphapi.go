package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// --- MorphAPI (https://www.aidjapi.top) 余额查询 ---
//
// MorphAPI is an OpenAI-compatible (new-api / one-api class) relay panel. Its
// ccswitch usageScript contract is:
//
//	GET {baseUrl}/v1/usage        (baseUrl has trailing "/" and "/v1" stripped)
//	Authorization: Bearer <API_KEY>
//
// The response is a wallet balance (remaining / balance / unit / is_active),
// NOT a windowed usage quota, so it serves one-time subscriptions only:
// recurring subscriptions have no额度 query endpoint for this provider. The
//额度 extractor (?? chain) is shared with FastAI in coalescing.go.
//
// A live probe documented in the handoff showed the panel's non-2xx body is a
// JSON object rather than plain text, e.g.
//
//	HTTP 403 {"code":"GROUP_DELETED","message":"API Key 所属分组已删除"}
//
// so decodeRelayError surfaces that message instead of a bare status code.
// The backend guard chain maps a handler error to a 502 with this text.

const morphapiBalanceURL = "https://www.aidjapi.top/v1/usage"

// fetchMorphAPIQuota issues the余额 request and normalizes it with the shared
// ccswitch extractor. It is the single fetch seam for the provider.
func fetchMorphAPIQuota(ctx context.Context, client HTTPDoer, apiKey string) (relayQuota, error) {
	response, err := doGET(ctx, client, morphapiBalanceURL, map[string]string{
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

// --- one-time subscriptions (balance query) ---

type morphapiBalanceHandler struct{ client HTTPDoer }

func (h *morphapiBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	q, err := fetchMorphAPIQuota(ctx, h.client, credentials["apiKey"])
	if err != nil {
		return BalanceResult{}, err
	}
	planName := q.planName
	return BalanceResult{
		Provider:    "morphapi",
		IsAvailable: q.isValid,
		BalanceInfos: []BalanceInfo{{
			Currency:  q.unit,
			Available: toFixed2(q.remaining),
			Total:     &planName,
		}},
	}, nil
}

func (h *morphapiBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, morphapiBalanceURL, credentials["apiKey"])
}

// FetchMorphAPIBalance is the exported entry point for the one-time path.
func FetchMorphAPIBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	return (&morphapiBalanceHandler{client: client}).FetchBalance(ctx, map[string]string{"apiKey": apiKey})
}

var _ BalanceHandler = (*morphapiBalanceHandler)(nil)
