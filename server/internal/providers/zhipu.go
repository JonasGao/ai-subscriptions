package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Port of lib/providers/zhipu.ts (ticket #33): BigModel Coding Plan quota
// query and credential test. Window decoding follows ADR-0011 — rows are
// keyed by unit/number (3/5 = 5-hour, 6/1 = weekly) and unknown rows degrade
// to warnings instead of failing the whole query.

const zhipuQuotaAPIURL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit"

type zhipuUsageHandler struct{ client HTTPDoer }

func (h *zhipuUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchZhipuUsage(ctx, h.client, credentials)
}

func (h *zhipuUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testZhipuConnection(ctx, h.client, credentials)
}

type zhipuEnvelope struct {
	Code    *float64 `json:"code"`
	Msg     string   `json:"msg"`
	Success *bool    `json:"success"`
	Data    *struct {
		Limits []map[string]any `json:"limits"`
		Level  string           `json:"level"`
	} `json:"data"`
}

func fetchZhipuEnvelope(ctx context.Context, client HTTPDoer, apiKey string) (*zhipuEnvelope, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, zhipuQuotaAPIURL, nil)
	if err != nil {
		return nil, 0, err
	}
	// The old stack sends the raw key, not a Bearer token.
	req.Header.Set("Authorization", apiKey)

	response, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, response.StatusCode, nil
	}

	var envelope zhipuEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return nil, response.StatusCode, err
	}
	return &envelope, response.StatusCode, nil
}

// FetchZhipuUsage ports fetchZhipuUsage.
func FetchZhipuUsage(ctx context.Context, client HTTPDoer, credentials map[string]string) (UsageResult, error) {
	apiKey := credentials["apiKey"]
	if apiKey == "" {
		return UsageResult{}, fmt.Errorf("API Key not configured")
	}

	envelope, status, err := fetchZhipuEnvelope(ctx, client, apiKey)
	if err != nil {
		return UsageResult{}, err
	}
	if envelope == nil {
		return UsageResult{}, fmt.Errorf("Zhipu usage API returned %d", status)
	}

	if envelope.Code == nil || *envelope.Code != 200 || (envelope.Success != nil && !*envelope.Success) {
		if envelope.Msg != "" {
			return UsageResult{}, fmt.Errorf("%s", envelope.Msg)
		}
		return UsageResult{}, fmt.Errorf("Zhipu usage API returned failure")
	}

	if envelope.Data == nil || len(envelope.Data.Limits) == 0 {
		return UsageResult{}, fmt.Errorf("未检测到 Coding Plan 订阅")
	}

	var fiveHourRow, weeklyRow map[string]any
	var warnings []string

	for _, row := range envelope.Data.Limits {
		if rowType, ok := row["type"].(string); !ok || rowType != "CREDIT_LIMIT" {
			warnings = append(warnings, "未识别的配额类型: "+zhipuMissingString(row, "type", "(missing)"))
			continue
		}

		isFiveHour := zhipuNumberEquals(row["unit"], 3) && zhipuNumberEquals(row["number"], 5)
		isWeekly := zhipuNumberEquals(row["unit"], 6) && zhipuNumberEquals(row["number"], 1)

		if !isFiveHour && !isWeekly {
			warnings = append(warnings, fmt.Sprintf(
				"未识别的配额窗口: unit=%s, number=%s",
				zhipuMissingString(row, "unit", "undefined"),
				zhipuMissingString(row, "number", "undefined"),
			))
			continue
		}

		// Same-bucket conflict: keep the row with the higher limit (usage).
		current := fiveHourRow
		if !isFiveHour {
			current = weeklyRow
		}
		if current == nil || zhipuNumberOrZero(row["usage"]) > zhipuNumberOrZero(current["usage"]) {
			if isFiveHour {
				fiveHourRow = row
			} else {
				weeklyRow = row
			}
		}
	}

	if fiveHourRow == nil && weeklyRow == nil {
		return UsageResult{}, fmt.Errorf("未识别到可用的配额窗口（CREDIT_LIMIT）")
	}

	result := UsageResult{
		Provider: "zhipu",
		FiveHour: zhipuRowToUsageWindow(fiveHourRow),
		Weekly:   zhipuRowToUsageWindow(weeklyRow),
		Warnings: warnings,
	}
	if level := envelope.Data.Level; level != "" {
		result.Membership = &UsageMembership{Level: strings.ToUpper(level)}
	}
	return result, nil
}

// testZhipuConnection ports testZhipuConnection.
func testZhipuConnection(ctx context.Context, client HTTPDoer, credentials map[string]string) (ConnectionResult, error) {
	apiKey := credentials["apiKey"]
	if apiKey == "" {
		return ConnectionResult{OK: false, Message: "API Key 未配置"}, nil
	}

	envelope, status, err := fetchZhipuEnvelope(ctx, client, apiKey)
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	if envelope == nil {
		switch status {
		case http.StatusUnauthorized, http.StatusForbidden:
			return ConnectionResult{OK: false, Message: "API Key 无效"}, nil
		default:
			return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", status)}, nil
		}
	}

	if envelope.Code == nil || *envelope.Code != 200 || (envelope.Success != nil && !*envelope.Success) {
		if envelope.Msg != "" {
			return ConnectionResult{OK: false, Message: envelope.Msg}, nil
		}
		return ConnectionResult{OK: false, Message: "Zhipu usage API returned failure"}, nil
	}
	if envelope.Data == nil || len(envelope.Data.Limits) == 0 {
		return ConnectionResult{OK: false, Message: "未检测到 Coding Plan 订阅"}, nil
	}

	if level := envelope.Data.Level; level != "" {
		return ConnectionResult{OK: true, Message: fmt.Sprintf("已连接 (%s)", strings.ToUpper(level))}, nil
	}
	return ConnectionResult{OK: true, Message: "已连接"}, nil
}

// zhipuRowToUsageWindow maps used←currentValue, limit←usage,
// remaining←remaining and epoch-ms nextResetTime → ISO-8601.
func zhipuRowToUsageWindow(row map[string]any) *UsageWindow {
	if row == nil {
		return nil
	}
	used := "0"
	if value, ok := row["currentValue"]; ok && value != nil {
		used = jsString(value)
	}
	remaining := "0"
	if value, ok := row["remaining"]; ok && value != nil {
		remaining = jsString(value)
	}

	var resetTime *string
	if value, ok := row["nextResetTime"].(float64); ok {
		iso := isoMillis(value)
		resetTime = &iso
	}

	return &UsageWindow{
		Used:      used,
		Limit:     zhipuMissingString(row, "usage", "undefined"),
		Remaining: remaining,
		ResetTime: resetTime,
	}
}

func zhipuNumberEquals(value any, want float64) bool {
	number, ok := value.(float64)
	return ok && number == want
}

func zhipuNumberOrZero(value any) float64 {
	if value == nil {
		return 0
	}
	number, _ := jsNumber(value)
	return number
}

// zhipuMissingString renders a map value with a fallback for absent keys,
// mirroring the old template literals' "undefined" / "(missing)" branches.
func zhipuMissingString(row map[string]any, key, fallback string) string {
	value, ok := row[key]
	if !ok {
		return fallback
	}
	return jsString(value)
}
