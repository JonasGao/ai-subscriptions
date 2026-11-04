package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
)

// Port of lib/providers/opencode.ts (ticket #33): OpenCode Go quota windows
// synthesized from percent (ADR-0010), plus the expired-key/401 distinction.

const opencodeGoUsageAPIURL = "https://opencode.ai/zen/go/v1/usage"

type opencodeUsageHandler struct{ client HTTPDoer }

func (h *opencodeUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchOpencodeGoUsage(ctx, h.client, credentials)
}

func (h *opencodeUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testOpencodeConnection(ctx, h.client, credentials)
}

func doOpencodeGET(ctx context.Context, client HTTPDoer, apiKey string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opencodeGoUsageAPIURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	return client.Do(req)
}

// FetchOpencodeGoUsage ports fetchOpencodeGoUsage.
func FetchOpencodeGoUsage(ctx context.Context, client HTTPDoer, credentials map[string]string) (UsageResult, error) {
	apiKey := credentials["apiKey"]
	if apiKey == "" {
		return UsageResult{}, fmt.Errorf("API Key 未配置")
	}

	response, err := doOpencodeGET(ctx, client, apiKey)
	if err != nil {
		return UsageResult{}, err
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusUnauthorized {
		return UsageResult{}, fmt.Errorf("%s", describeOpencodeAuthError(response))
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return UsageResult{}, fmt.Errorf("API 返回 %d", response.StatusCode)
	}

	var data map[string]any
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return UsageResult{}, err
	}

	windows, _ := data["usage"].(map[string]any)
	result := UsageResult{Provider: "opencode"}
	if raw, ok := windows["rolling"].(map[string]any); ok {
		result.FiveHour = synthesizeOpencodeWindow(raw)
	}
	if raw, ok := windows["weekly"].(map[string]any); ok {
		result.Weekly = synthesizeOpencodeWindow(raw)
	}
	if raw, ok := windows["monthly"].(map[string]any); ok {
		result.Monthly = synthesizeOpencodeWindow(raw)
	}
	return result, nil
}

// testOpencodeConnection ports testOpencodeConnection.
func testOpencodeConnection(ctx context.Context, client HTTPDoer, credentials map[string]string) (ConnectionResult, error) {
	apiKey := credentials["apiKey"]
	if apiKey == "" {
		return ConnectionResult{OK: false, Message: "API Key 未配置"}, nil
	}

	response, err := doOpencodeGET(ctx, client, apiKey)
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusUnauthorized {
		return ConnectionResult{OK: false, Message: describeOpencodeAuthError(response)}, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", response.StatusCode)}, nil
	}
	return ConnectionResult{OK: true, Message: "已配置"}, nil
}

// describeOpencodeAuthError separates an expired key ("api_key_expired") from
// an invalid one. A missing/unparsable body falls back to the generic message.
func describeOpencodeAuthError(response *http.Response) string {
	var data struct {
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&data); err == nil {
		if data.Error != nil && data.Error.Code == "api_key_expired" {
			return "API Key 已过期，请到 OpenCode Console 创建新 Key 并更新订阅凭据（重新登录不会续期）"
		}
	}
	return "API Key 无效或未配置"
}

// synthesizeOpencodeWindow applies ADR-0010: limit is fixed at 100, used is the
// reported percent (rate-limited forces at least 100 so auto-exhaust fires),
// and remaining is clamped at zero while preserving overage > 100.
func synthesizeOpencodeWindow(raw map[string]any) *UsageWindow {
	percent := 0.0
	if value, ok := raw["percent"].(float64); ok {
		percent = value
	}
	used := percent
	if status, _ := raw["status"].(string); status == "rate-limited" {
		used = math.Max(percent, 100)
	}
	remaining := math.Max(0, 100-used)

	var resetTime *string
	if value, ok := raw["resetsAt"].(string); ok {
		resetTime = &value
	}

	return &UsageWindow{
		Limit:     "100",
		Used:      formatJSFloat(used),
		Remaining: formatJSFloat(remaining),
		ResetTime: resetTime,
	}
}
