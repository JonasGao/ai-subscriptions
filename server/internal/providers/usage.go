package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ai-subscriptions/internal/volcengine"
)

// UsageWindow is one quota window (5-hour / weekly / monthly). ResetTime is
// nullable because providers sometimes omit it (ADR-0010 / old
// UsageWindow.resetTime semantics).
type UsageWindow struct {
	Limit     string  `json:"limit"`
	Used      string  `json:"used"`
	Remaining string  `json:"remaining"`
	ResetTime *string `json:"resetTime"`
}

// UsageBoosterWallet mirrors the optional Kimi booster wallet payload.
type UsageBoosterWallet struct {
	Balance     *BoosterBalance     `json:"balance"`
	MonthlyUsed *BoosterMonthlyUsed `json:"monthlyUsed"`
	Status      string              `json:"status"`
}

// BoosterBalance is the wallet balance block.
type BoosterBalance struct {
	Amount     string `json:"amount"`
	AmountLeft string `json:"amountLeft"`
	Unit       string `json:"unit"`
	Type       string `json:"type"`
}

// BoosterMonthlyUsed is the wallet monthly spend block.
type BoosterMonthlyUsed struct {
	Currency     string `json:"currency"`
	PriceInCents string `json:"priceInCents"`
}

// UsageParallel is the optional parallel-limit block.
type UsageParallel struct {
	Limit string `json:"limit"`
}

// UsageMembership is the optional membership block.
type UsageMembership struct {
	Level string `json:"level"`
}

// UsageResult is the normalized usage query result (lib/types.ts UsageResult).
type UsageResult struct {
	Provider      string              `json:"provider"`
	FiveHour      *UsageWindow        `json:"fiveHour"`
	Weekly        *UsageWindow        `json:"weekly"`
	Monthly       *UsageWindow        `json:"monthly"`
	BoosterWallet *UsageBoosterWallet `json:"boosterWallet"`
	Parallel      *UsageParallel      `json:"parallel"`
	Membership    *UsageMembership    `json:"membership"`
	// Warnings surfaces server-side parse anomalies to the frontend.
	Warnings []string `json:"warnings,omitempty"`
}

// ConnectionResult is the credential test outcome.
type ConnectionResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// HTTPDoer is the subset of *http.Client the handlers need; tests inject a
// canned implementation instead of mocking a package-global fetch.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// UsageHandler is the usage-query contract for a provider/plan.
type UsageHandler interface {
	FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error)
	TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error)
}

// DefaultHTTPClient is the client registry handlers bind to.
var DefaultHTTPClient HTTPDoer = &http.Client{Timeout: 10 * time.Second}

// ResolveUsageHandlerKey ports lib/providers/index.ts resolveUsageHandlerKey:
// "<providerId>:<planId>" when a plan is set, bare provider id otherwise.
func ResolveUsageHandlerKey(provider, planID string) string {
	if planID != "" {
		return provider + ":" + planID
	}
	return provider
}

// usageHandlerKeys is the static registration key set of
// lib/providers/index.ts usageHandlers. Capability flags derive from this set
// (ADR-0006). Handler bodies for providers owned by later parity tickets
// (#30-#33) are not implemented yet; those tickets add them to UsageHandlers
// without changing this key set.
func usageHandlerKeys() []string {
	return []string{
		"moonshot:kimi-code",
		"fangzhou:agentplan",
		"fangzhou:codingplan",
		"alibaba:token-plan",
		"github",
		"opencode:go",
		"zhipu:coding-plan",
	}
}

// UsageHandlers returns the implemented usage handlers. Keys that are
// registered in the old stack but whose bodies land with later tickets are
// absent here, so a lookup for them finds no handler instead of one that
// cannot work.
func UsageHandlers() map[string]UsageHandler {
	return map[string]UsageHandler{
		"fangzhou:agentplan":  &agentPlanUsageHandler{client: DefaultHTTPClient},
		"fangzhou:codingplan": &codingPlanUsageHandler{client: DefaultHTTPClient},
		"moonshot:kimi-code":  &moonshotUsageHandler{client: DefaultHTTPClient},
	}
}

// balanceHandlerKeys is the registered key set of lib/providers/index.ts
// balanceHandlers. Implementations land with the balance query ticket (#28);
// capability flags only need the registration keys.
func balanceHandlerKeys() map[string]struct{} {
	return map[string]struct{}{
		"moonshot":    {},
		"deepseek":    {},
		"siliconflow": {},
		"openrouter":  {},
	}
}

// --- JSON helpers mirroring the old TypeScript coercions ---

// jsNumber converts a decoded JSON value to a float64 the way JS Number()
// would for the shapes these APIs return (string or number).
func jsNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil {
			return 0, false
		}
		return f, true
	case json.Number:
		f, err := n.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	case int:
		return float64(n), true
	default:
		return 0, false
	}
}

// jsNumberOrNaN is jsNumber with JS Number()'s NaN fallback.
func jsNumberOrNaN(v any) float64 {
	if f, ok := jsNumber(v); ok {
		return f
	}
	return math.NaN()
}

// jsString mimics String(value) for strings and numbers.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case float64:
		return formatJSFloat(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(x)
	}
}

// formatJSFloat renders a float the way JS String(number) does for the
// integral quota values used here (250 → "250", 30.5 → "30.5").
func formatJSFloat(f float64) string {
	if math.IsNaN(f) {
		return "NaN"
	}
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	if math.IsInf(f, -1) {
		return "-Infinity"
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// isoMillis renders epoch milliseconds as an ISO-8601 UTC timestamp with
// millisecond precision (JS toISOString output).
func isoMillis(ms float64) string {
	return time.UnixMilli(int64(ms)).UTC().Format("2006-01-02T15:04:05.000Z")
}

func isoSeconds(seconds float64) string {
	return isoMillis(seconds * 1000)
}

// --- Moonshot usage (lib/providers/moonshot.ts) ---

type moonshotUsageHandler struct{ client HTTPDoer }

func (h *moonshotUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchMoonshotUsage(ctx, h.client, credentials["apiKey"], "https://api.kimi.com/coding/v1/usages")
}

func (h *moonshotUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, "https://api.moonshot.cn/v1/users/me/balance", credentials["apiKey"])
}

// FetchMoonshotUsage ports fetchMoonshotUsage.
func FetchMoonshotUsage(ctx context.Context, client HTTPDoer, apiKey, usageAPIURL string) (UsageResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, usageAPIURL, nil)
	if err != nil {
		return UsageResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	response, err := client.Do(req)
	if err != nil {
		return UsageResult{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return UsageResult{}, fmt.Errorf("Moonshot usage API returned %d", response.StatusCode)
	}

	var data map[string]any
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return UsageResult{}, err
	}

	// Top-level usage is the weekly quota (7-day window).
	weekly := normalizeUsageWindow(data["usage"])

	rawLimits, _ := data["limits"].([]any)
	pickLimitWindow := func(hours float64) *UsageWindow {
		for _, item := range rawLimits {
			record, ok := item.(map[string]any)
			if !ok {
				continue
			}
			window, ok := record["window"].(map[string]any)
			if !ok {
				continue
			}
			duration, _ := jsNumber(window["duration"])
			unit, _ := window["timeUnit"].(string)
			if windowHours(duration, unit) == hours {
				return normalizeUsageWindow(record["detail"])
			}
		}
		return nil
	}

	result := UsageResult{
		Provider: "moonshot",
		FiveHour: pickLimitWindow(5),
		Weekly:   weekly,
		Monthly:  pickLimitWindow(24 * 30),
	}

	if booster, ok := data["boosterWallet"].(map[string]any); ok {
		result.BoosterWallet = parseBoosterWallet(booster)
	}
	if parallel, ok := data["parallel"].(map[string]any); ok {
		result.Parallel = &UsageParallel{Limit: stringOr(parallel["limit"], "")}
	}

	// Real API nests membership under user; fall back to top-level.
	var membershipRaw map[string]any
	if user, ok := data["user"].(map[string]any); ok {
		membershipRaw, _ = user["membership"].(map[string]any)
	}
	if membershipRaw == nil {
		membershipRaw, _ = data["membership"].(map[string]any)
	}
	if membershipRaw != nil {
		result.Membership = &UsageMembership{Level: stringOr(membershipRaw["level"], "")}
	}

	return result, nil
}

func parseBoosterWallet(booster map[string]any) *UsageBoosterWallet {
	wallet := &UsageBoosterWallet{Status: stringOr(booster["status"], "")}
	if balance, ok := booster["balance"].(map[string]any); ok {
		wallet.Balance = &BoosterBalance{
			Amount:     stringOr(balance["amount"], ""),
			AmountLeft: stringOr(balance["amountLeft"], ""),
			Unit:       stringOr(balance["unit"], ""),
			Type:       stringOr(balance["type"], ""),
		}
	}
	if monthlyUsed, ok := booster["monthlyUsed"].(map[string]any); ok {
		wallet.MonthlyUsed = &BoosterMonthlyUsed{
			Currency:     stringOr(monthlyUsed["currency"], ""),
			PriceInCents: stringOr(monthlyUsed["priceInCents"], ""),
		}
	}
	return wallet
}

func stringOr(v any, fallback string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fallback
}

func windowHours(duration float64, timeUnit string) float64 {
	switch timeUnit {
	case "TIME_UNIT_SECOND":
		return duration / 3600
	case "TIME_UNIT_MINUTE":
		return duration / 60
	case "TIME_UNIT_HOUR":
		return duration
	case "TIME_UNIT_DAY":
		return duration * 24
	default:
		return -1
	}
}

// normalizeUsageWindow ports moonshot.ts normalizeUsageWindow: proto3 JSON
// omits zero-valued fields, so derive whichever side is missing.
func normalizeUsageWindow(raw any) *UsageWindow {
	record, ok := raw.(map[string]any)
	if !ok {
		return nil
	}

	limitRaw, hasLimit := record["limit"]
	usedRaw, hasUsed := record["used"]
	remainingRaw, hasRemaining := record["remaining"]
	// JS: record.resetTime ?? record.reset_time — null falls through too.
	resetRaw, hasReset := record["resetTime"]
	if !hasReset || resetRaw == nil {
		resetRaw, hasReset = record["reset_time"]
	}

	if !hasUsed && hasLimit && hasRemaining {
		// Mirrors String(Number(limit) - Number(remaining)); an unparsable
		// operand yields NaN, exactly like JS.
		usedRaw, hasUsed = formatJSFloat(jsNumberOrNaN(limitRaw)-jsNumberOrNaN(remainingRaw)), true
	}
	if !hasRemaining && hasLimit && hasUsed {
		remainingRaw, hasRemaining = formatJSFloat(jsNumberOrNaN(limitRaw)-jsNumberOrNaN(usedRaw)), true
	}

	if !hasLimit || !hasUsed || !hasRemaining || !hasReset {
		return nil
	}

	resetTime := jsString(resetRaw)
	return &UsageWindow{
		Limit:     jsString(limitRaw),
		Used:      jsString(usedRaw),
		Remaining: jsString(remainingRaw),
		ResetTime: &resetTime,
	}
}

// --- Fangzhou Agent Plan usage (lib/providers/fangzhou-agentplan.ts) ---

const (
	agentPlanUsageURL  = "https://open.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01"
	agentPlanTestURL   = "https://open.volcengineapi.com/?Action=ListSubscribeTrade&Version=2024-01-01"
	codingPlanUsageURL = "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01"
	codingPlanTestURL  = "https://open.volcengineapi.com/?Action=ListSubscribeTrade&Version=2024-01-01"
)

type agentPlanUsageHandler struct{ client HTTPDoer }

func (h *agentPlanUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchAgentPlanUsage(ctx, h.client, credentials)
}

func (h *agentPlanUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testVolcengineConnection(ctx, h.client, credentials, agentPlanTestURL, "RealAgentPlanPersonal", "未检测到 AgentPlan 订阅")
}

type agentPlanPeriod struct {
	Used      float64 `json:"Used"`
	Quota     float64 `json:"Quota"`
	ResetTime float64 `json:"ResetTime"`
}

// FetchAgentPlanUsage ports fetchAgentPlanUsage: the API returns a flat
// Result.{AFPFiveHour,AFPWeekly,AFPMonthly,AFPDaily}; AFPDaily is ignored.
func FetchAgentPlanUsage(ctx context.Context, client HTTPDoer, credentials map[string]string) (UsageResult, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return UsageResult{}, fmt.Errorf("AK/SK not configured")
	}

	body := "{}"
	headers := signVolcengineRequest(agentPlanUsageURL, body, ak, sk)
	response, err := postVolcengine(ctx, client, agentPlanUsageURL, body, headers)
	if err != nil {
		return UsageResult{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return UsageResult{}, fmt.Errorf("AgentPlan usage API returned %d", response.StatusCode)
	}

	var payload struct {
		Result *struct {
			AFPFiveHour *agentPlanPeriod `json:"AFPFiveHour"`
			AFPWeekly   *agentPlanPeriod `json:"AFPWeekly"`
			AFPMonthly  *agentPlanPeriod `json:"AFPMonthly"`
		} `json:"Result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return UsageResult{}, err
	}

	if payload.Result == nil || payload.Result.AFPWeekly == nil {
		return UsageResult{}, fmt.Errorf("Account not subscribed to AgentPlan")
	}

	result := UsageResult{Provider: "fangzhou"}
	if payload.Result.AFPFiveHour != nil {
		result.FiveHour = agentPlanPeriodToWindow(*payload.Result.AFPFiveHour)
	}
	result.Weekly = agentPlanPeriodToWindow(*payload.Result.AFPWeekly)
	if payload.Result.AFPMonthly != nil {
		result.Monthly = agentPlanPeriodToWindow(*payload.Result.AFPMonthly)
	}
	return result, nil
}

func agentPlanPeriodToWindow(period agentPlanPeriod) *UsageWindow {
	remaining := period.Quota - period.Used
	var resetTime *string
	if period.ResetTime > 0 {
		iso := isoMillis(period.ResetTime)
		resetTime = &iso
	}
	return &UsageWindow{
		Used:      formatJSFloat(period.Used),
		Limit:     formatJSFloat(period.Quota),
		Remaining: formatJSFloat(remaining),
		ResetTime: resetTime,
	}
}

// --- Fangzhou Coding Plan usage (lib/providers/fangzhou-codingplan.ts) ---

type codingPlanUsageHandler struct{ client HTTPDoer }

func (h *codingPlanUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchCodingPlanUsage(ctx, h.client, credentials)
}

func (h *codingPlanUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testVolcengineConnection(ctx, h.client, credentials, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
}

type codingPlanQuota struct {
	Level          string   `json:"Level"`
	Percent        float64  `json:"Percent"`
	ResetTimestamp float64  `json:"ResetTimestamp"`
	Cap            *float64 `json:"Cap"`
}

// FetchCodingPlanUsage ports fetchCodingPlanUsage. QuotaUsage rows carry
// Level "session"|"weekly"|"monthly" (ADR-0012); unknown levels are skipped
// with a user-facing warning.
func FetchCodingPlanUsage(ctx context.Context, client HTTPDoer, credentials map[string]string) (UsageResult, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return UsageResult{}, fmt.Errorf("AK/SK not configured")
	}

	body := "{}"
	headers := signVolcengineRequest(codingPlanUsageURL, body, ak, sk)
	response, err := postVolcengine(ctx, client, codingPlanUsageURL, body, headers)
	if err != nil {
		return UsageResult{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return UsageResult{}, fmt.Errorf("CodingPlan usage API returned %d", response.StatusCode)
	}

	var payload struct {
		Result *struct {
			QuotaUsage []codingPlanQuota `json:"QuotaUsage"`
		} `json:"Result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return UsageResult{}, err
	}
	if payload.Result == nil || len(payload.Result.QuotaUsage) == 0 {
		return UsageResult{}, fmt.Errorf("Account not subscribed to CodingPlan")
	}

	var sessionRow, weeklyRow, monthlyRow *codingPlanQuota
	var warnings []string
	for i := range payload.Result.QuotaUsage {
		row := &payload.Result.QuotaUsage[i]
		switch row.Level {
		case "session":
			sessionRow = row
		case "weekly":
			weeklyRow = row
		case "monthly":
			monthlyRow = row
		default:
			warnings = append(warnings, "未识别的配额窗口: "+row.Level)
		}
	}

	result := UsageResult{
		Provider: "fangzhou",
		FiveHour: codingPlanRowToWindow(sessionRow),
		Weekly:   codingPlanRowToWindow(weeklyRow),
		Monthly:  codingPlanRowToWindow(monthlyRow),
		Warnings: warnings,
	}
	return result, nil
}

func codingPlanRowToWindow(row *codingPlanQuota) *UsageWindow {
	if row == nil {
		return nil
	}
	limit := 100.0
	if row.Cap != nil {
		limit = *row.Cap
	}
	var resetTime *string
	if row.ResetTimestamp != 0 {
		iso := isoSeconds(row.ResetTimestamp)
		resetTime = &iso
	}
	return &UsageWindow{
		Used:      formatJSFloat(row.Percent),
		Limit:     formatJSFloat(limit),
		Remaining: formatJSFloat(limit - row.Percent),
		ResetTime: resetTime,
	}
}

func postVolcengine(ctx context.Context, client HTTPDoer, url, body string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return client.Do(req)
}

func testVolcengineConnection(ctx context.Context, client HTTPDoer, credentials map[string]string, url, resourceName, notSubscribedMessage string) (ConnectionResult, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return ConnectionResult{OK: false, Message: "AK/SK 未配置"}, nil
	}

	body, err := json.Marshal(map[string][]string{"ResourceNames": {resourceName}})
	if err != nil {
		return ConnectionResult{}, err
	}
	bodyString := string(body)
	headers := signVolcengineRequest(url, bodyString, ak, sk)

	response, err := postVolcengine(ctx, client, url, bodyString, headers)
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", response.StatusCode)}, nil
	}

	var payload struct {
		Result *struct {
			InfoList []struct {
				BizInfo string `json:"BizInfo"`
				Status  string `json:"Status"`
			} `json:"InfoList"`
		} `json:"Result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	if payload.Result != nil && len(payload.Result.InfoList) > 0 {
		inst := payload.Result.InfoList[0]
		bizInfo := inst.BizInfo
		if bizInfo == "" {
			bizInfo = "unknown"
		}
		status := inst.Status
		if status == "" {
			status = "unknown"
		}
		return ConnectionResult{OK: true, Message: fmt.Sprintf("已订阅 (%s, %s)", bizInfo, status)}, nil
	}
	return ConnectionResult{OK: false, Message: notSubscribedMessage}, nil
}

func testConnection(ctx context.Context, client HTTPDoer, url, apiKey string) (ConnectionResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ConnectionResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := client.Do(req)
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return ConnectionResult{OK: true, Message: "连接成功"}, nil
	}
	return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", response.StatusCode)}, nil
}

// signVolcengineRequest wraps the V4 signer for the POST signed API actions.
func signVolcengineRequest(url, body, ak, sk string) map[string]string {
	return volcengine.Sign(volcengine.SignOptions{
		Method: http.MethodPost,
		URL:    url,
		Body:   body,
		AK:     ak,
		SK:     sk,
	})
}
