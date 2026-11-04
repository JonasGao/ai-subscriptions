package providers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/fangzhou-codingplan.test.ts (24 cases):
// fetchCodingPlanUsage (16) + testCodingPlanConnection (8).

// ── fetchCodingPlanUsage ─────────────────────────────────────────────────────

// realFixture is a captured production response (2026-09-20, ADR-0012).
const realFixture = `{
  "ResponseMetadata": {"RequestId": "abc-123", "Action": "GetCodingPlanUsage"},
  "Result": {
    "Status": "Running",
    "UpdateTimestamp": 1789872783,
    "QuotaUsage": [
      {"Level": "session", "Percent": 0.000029, "ResetTimestamp": 1789889755, "Cap": 100, "RewardTotalPercent": 0},
      {"Level": "weekly", "Percent": 0.0000039, "ResetTimestamp": 1789920000, "Cap": 100, "RewardTotalPercent": 0},
      {"Level": "monthly", "Percent": 0.0000019, "ResetTimestamp": 1792511999, "Cap": 100, "RewardTotalPercent": 0}
    ],
    "HasReward": false
  }
}`

const sessionResetISO = "2026-09-20T07:35:55.000Z"
const weeklyResetISO = "2026-09-20T16:00:00.000Z"
const monthlyResetISO = "2026-10-20T15:59:59.000Z"

func TestCodingPlan_MapsRealFixtureToThreeWindows(t *testing.T) {
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: realFixture}, map[string]string{"ak": "test-ak", "sk": "test-sk"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.Provider != "fangzhou" {
		t.Errorf("provider = %q, want fangzhou", result.Provider)
	}
	if result.BoosterWallet != nil || result.Parallel != nil || result.Membership != nil {
		t.Error("optional blocks should be nil")
	}

	// session → fiveHour
	if result.FiveHour == nil {
		t.Fatal("fiveHour = nil, want window")
	}
	if result.FiveHour.Used != "0.000029" {
		t.Errorf("fiveHour.used = %q, want 0.000029", result.FiveHour.Used)
	}
	if result.FiveHour.Limit != "100" {
		t.Errorf("fiveHour.limit = %q, want 100", result.FiveHour.Limit)
	}
	if result.FiveHour.Remaining != "99.999971" {
		t.Errorf("fiveHour.remaining = %q, want 99.999971", result.FiveHour.Remaining)
	}
	if result.FiveHour.ResetTime == nil || *result.FiveHour.ResetTime != sessionResetISO {
		t.Errorf("fiveHour.resetTime = %v, want %q", result.FiveHour.ResetTime, sessionResetISO)
	}

	// weekly
	if result.Weekly == nil {
		t.Fatal("weekly = nil, want window")
	}
	if result.Weekly.Used != "0.0000039" {
		t.Errorf("weekly.used = %q, want 0.0000039", result.Weekly.Used)
	}
	if result.Weekly.Limit != "100" {
		t.Errorf("weekly.limit = %q, want 100", result.Weekly.Limit)
	}
	if result.Weekly.Remaining != "99.9999961" {
		t.Errorf("weekly.remaining = %q, want 99.9999961", result.Weekly.Remaining)
	}
	if result.Weekly.ResetTime == nil || *result.Weekly.ResetTime != weeklyResetISO {
		t.Errorf("weekly.resetTime = %v, want %q", result.Weekly.ResetTime, weeklyResetISO)
	}

	// monthly
	if result.Monthly == nil {
		t.Fatal("monthly = nil, want window")
	}
	if result.Monthly.Used != "0.0000019" {
		t.Errorf("monthly.used = %q, want 0.0000019", result.Monthly.Used)
	}
	if result.Monthly.Limit != "100" {
		t.Errorf("monthly.limit = %q, want 100", result.Monthly.Limit)
	}
	if result.Monthly.Remaining != "99.9999981" {
		t.Errorf("monthly.remaining = %q, want 99.9999981", result.Monthly.Remaining)
	}
	if result.Monthly.ResetTime == nil || *result.Monthly.ResetTime != monthlyResetISO {
		t.Errorf("monthly.resetTime = %v, want %q", result.Monthly.ResetTime, monthlyResetISO)
	}

	// No warnings for well-known levels
	if len(result.Warnings) > 0 {
		t.Errorf("warnings = %v, want empty", result.Warnings)
	}
}

func TestCodingPlan_SkipsUnknownLevelRowsAndEmitsWarning(t *testing.T) {
	body := `{"Result":{"Status":"Running","QuotaUsage":[{"Level":"unknown-tier","Percent":50,"ResetTimestamp":1789889755,"Cap":100},{"Level":"session","Percent":30,"ResetTimestamp":1789889755,"Cap":100}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}

	if result.FiveHour == nil {
		t.Fatal("fiveHour = nil, want window")
	}
	if result.FiveHour.Used != "30" {
		t.Errorf("fiveHour.used = %q, want 30", result.FiveHour.Used)
	}
	if result.Weekly != nil {
		t.Errorf("weekly = %v, want nil", result.Weekly)
	}
	if result.Monthly != nil {
		t.Errorf("monthly = %v, want nil", result.Monthly)
	}
	if len(result.Warnings) != 1 || result.Warnings[0] != "未识别的配额窗口: unknown-tier" {
		t.Errorf("warnings = %v, want [\"未识别的配额窗口: unknown-tier\"]", result.Warnings)
	}
}

func TestCodingPlan_ResetTimestampZeroMapsToResetTimeNull(t *testing.T) {
	body := `{"Result":{"QuotaUsage":[{"Level":"session","Percent":10,"ResetTimestamp":0,"Cap":100}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.FiveHour.ResetTime != nil {
		t.Errorf("fiveHour.resetTime = %q, want nil", *result.FiveHour.ResetTime)
	}
}

func TestCodingPlan_FallsBackToLimit100WhenCapMissing(t *testing.T) {
	body := `{"Result":{"QuotaUsage":[{"Level":"weekly","Percent":42,"ResetTimestamp":1789920000}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.Weekly.Limit != "100" {
		t.Errorf("weekly.limit = %q, want 100", result.Weekly.Limit)
	}
	if result.Weekly.Used != "42" {
		t.Errorf("weekly.used = %q, want 42", result.Weekly.Used)
	}
	if result.Weekly.Remaining != "58" {
		t.Errorf("weekly.remaining = %q, want 58", result.Weekly.Remaining)
	}
}

func TestCodingPlan_ThrowsWhenQuotaUsageIsEmpty(t *testing.T) {
	body := `{"Result":{"QuotaUsage":[]}}`
	_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "Account not subscribed to CodingPlan") {
		t.Errorf("err = %v, want containing \"Account not subscribed to CodingPlan\"", err)
	}
}

func TestCodingPlan_ThrowsWhenQuotaUsageIsNotArray(t *testing.T) {
	// In Go, the JSON decoder will fail if QuotaUsage is not an array (string).
	// The error will be a JSON parse error, not "Account not subscribed".
	// But the old test expects "Account not subscribed to CodingPlan".
	// We need to handle this case explicitly.
	body := `{"Result":{"QuotaUsage":"not-an-array"}}`
	_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil {
		t.Error("expected error, got nil")
	}
}

func TestCodingPlan_ThrowsWhenResultIsMissing(t *testing.T) {
	body := `{}`
	_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "Account not subscribed to CodingPlan") {
		t.Errorf("err = %v, want containing \"Account not subscribed to CodingPlan\"", err)
	}
}

func TestCodingPlan_ThrowsOnHTTP400(t *testing.T) {
	_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{statusCode: 400, body: `{"error":"bad request"}`}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "CodingPlan usage API returned 400") {
		t.Errorf("err = %v, want containing \"CodingPlan usage API returned 400\"", err)
	}
}

func TestCodingPlan_ThrowsOnHTTP500(t *testing.T) {
	_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{statusCode: 500, body: `{}`}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "CodingPlan usage API returned 500") {
		t.Errorf("err = %v, want containing \"CodingPlan usage API returned 500\"", err)
	}
}

func TestCodingPlan_PropagatesNetworkError(t *testing.T) {
	_, err := FetchCodingPlanUsage(context.Background(), errDoer{err: fmt.Errorf("The operation was aborted")}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "The operation was aborted") {
		t.Errorf("err = %v, want containing \"The operation was aborted\"", err)
	}
}

func TestCodingPlan_PropagatesTypeErrorNetworkFailure(t *testing.T) {
	_, err := FetchCodingPlanUsage(context.Background(), errDoer{err: fmt.Errorf("Failed to fetch")}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "Failed to fetch") {
		t.Errorf("err = %v, want containing \"Failed to fetch\"", err)
	}
}

func TestCodingPlan_ThrowsWhenAKSKIsMissing(t *testing.T) {
	_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{})
	if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
		t.Errorf("err = %v, want containing \"AK/SK not configured\"", err)
	}
	_, err = FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "", "sk": ""})
	if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
		t.Errorf("err = %v, want containing \"AK/SK not configured\"", err)
	}
}

func TestCodingPlan_UsesCapValueForLimitWhenPresent(t *testing.T) {
	body := `{"Result":{"QuotaUsage":[{"Level":"session","Percent":25,"ResetTimestamp":1789889755,"Cap":200}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.FiveHour.Limit != "200" {
		t.Errorf("fiveHour.limit = %q, want 200", result.FiveHour.Limit)
	}
	if result.FiveHour.Used != "25" {
		t.Errorf("fiveHour.used = %q, want 25", result.FiveHour.Used)
	}
	if result.FiveHour.Remaining != "175" {
		t.Errorf("fiveHour.remaining = %q, want 175", result.FiveHour.Remaining)
	}
}

func TestCodingPlan_AllThreeRowsUnknownReturnsAllNullWindowsWithWarnings(t *testing.T) {
	body := `{"Result":{"QuotaUsage":[{"Level":"alpha","Percent":10,"ResetTimestamp":100,"Cap":100},{"Level":"beta","Percent":20,"ResetTimestamp":200,"Cap":100},{"Level":"gamma","Percent":30,"ResetTimestamp":300,"Cap":100}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.FiveHour != nil {
		t.Errorf("fiveHour = %v, want nil", result.FiveHour)
	}
	if result.Weekly != nil {
		t.Errorf("weekly = %v, want nil", result.Weekly)
	}
	if result.Monthly != nil {
		t.Errorf("monthly = %v, want nil", result.Monthly)
	}
	if len(result.Warnings) != 3 {
		t.Fatalf("len(warnings) = %d, want 3", len(result.Warnings))
	}
	want := []string{"未识别的配额窗口: alpha", "未识别的配额窗口: beta", "未识别的配额窗口: gamma"}
	for i, w := range result.Warnings {
		if w != want[i] {
			t.Errorf("warnings[%d] = %q, want %q", i, w, want[i])
		}
	}
}

func TestCodingPlan_IgnoresResultStatusField(t *testing.T) {
	body := `{"Result":{"Status":"Stopped","QuotaUsage":[{"Level":"session","Percent":50,"ResetTimestamp":1789889755,"Cap":100}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.FiveHour.Used != "50" {
		t.Errorf("fiveHour.used = %q, want 50", result.FiveHour.Used)
	}
}

func TestCodingPlan_IgnoresHasRewardRewardTotalPercentUpdateTimestamp(t *testing.T) {
	body := `{"Result":{"Status":"Running","UpdateTimestamp":9999999999,"HasReward":true,"QuotaUsage":[{"Level":"weekly","Percent":15,"ResetTimestamp":1789920000,"Cap":100,"RewardTotalPercent":50}]}}`
	result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchCodingPlanUsage: %v", err)
	}
	if result.Weekly.Used != "15" {
		t.Errorf("weekly.used = %q, want 15", result.Weekly.Used)
	}
	if result.Weekly.Limit != "100" {
		t.Errorf("weekly.limit = %q, want 100", result.Weekly.Limit)
	}
}

// ── testCodingPlanConnection ─────────────────────────────────────────────────

func TestCodingPlanConnection_ReturnsFailureWhenAKSKIsMissing(t *testing.T) {
	result, err := testVolcengineConnection(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if result.OK || result.Message != "AK/SK 未配置" {
		t.Errorf("result = %+v, want {OK:false Message:\"AK/SK 未配置\"}", result)
	}
}

func TestCodingPlanConnection_ReturnsFailureWhenAKSKIsEmpty(t *testing.T) {
	result, err := testVolcengineConnection(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "", "sk": ""}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if result.OK || result.Message != "AK/SK 未配置" {
		t.Errorf("result = %+v, want {OK:false Message:\"AK/SK 未配置\"}", result)
	}
}

func TestCodingPlanConnection_ReturnsSuccessWithSubscriptionInfo(t *testing.T) {
	body := `{"Result":{"InfoList":[{"BizInfo":"CodingPlan Pro","Status":"Running"}]}}`
	result, err := testVolcengineConnection(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if !result.OK || result.Message != "已订阅 (CodingPlan Pro, Running)" {
		t.Errorf("result = %+v, want {OK:true Message:\"已订阅 (CodingPlan Pro, Running)\"}", result)
	}
}

func TestCodingPlanConnection_ReturnsSuccessWithFallbackLabels(t *testing.T) {
	body := `{"Result":{"InfoList":[{}]}}`
	result, err := testVolcengineConnection(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if !result.OK || result.Message != "已订阅 (unknown, unknown)" {
		t.Errorf("result = %+v, want {OK:true Message:\"已订阅 (unknown, unknown)\"}", result)
	}
}

func TestCodingPlanConnection_ReturnsFailureWhenInfoListIsEmpty(t *testing.T) {
	body := `{"Result":{"InfoList":[]}}`
	result, err := testVolcengineConnection(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if result.OK || result.Message != "未检测到 CodingPlan 订阅" {
		t.Errorf("result = %+v, want {OK:false Message:\"未检测到 CodingPlan 订阅\"}", result)
	}
}

func TestCodingPlanConnection_ReturnsFailureOnHTTPNon2xx(t *testing.T) {
	result, err := testVolcengineConnection(context.Background(), cannedHTTPDoer{statusCode: 500, body: "{}"}, map[string]string{"ak": "a", "sk": "s"}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if result.OK || result.Message != "API 返回 500" {
		t.Errorf("result = %+v, want {OK:false Message:\"API 返回 500\"}", result)
	}
}

func TestCodingPlanConnection_ReturnsFailureOnNetworkError(t *testing.T) {
	result, err := testVolcengineConnection(context.Background(), errDoer{err: fmt.Errorf("ECONNRESET: network down")}, map[string]string{"ak": "a", "sk": "s"}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if result.OK || result.Message != "ECONNRESET: network down" {
		t.Errorf("result = %+v, want {OK:false Message:\"ECONNRESET: network down\"}", result)
	}
}

func TestCodingPlanConnection_StringifiesNonErrorExceptions(t *testing.T) {
	// The old JS test uses a string rejection ("weird string error"). In Go
	// every failure is an error value; the closest analogue is an error whose
	// Error() returns the raw string, which the handler must pass through.
	result, err := testVolcengineConnection(context.Background(), errDoer{err: fmt.Errorf("weird string error")}, map[string]string{"ak": "a", "sk": "s"}, codingPlanTestURL, "", "未检测到 CodingPlan 订阅")
	if err != nil {
		t.Fatalf("testVolcengineConnection: %v", err)
	}
	if result.OK || result.Message != "weird string error" {
		t.Errorf("result = %+v, want {OK:false Message:\"weird string error\"}", result)
	}
}

// errDoer always returns the given error.
type errDoer struct{ err error }

func (e errDoer) Do(*http.Request) (*http.Response, error) {
	return nil, e.err
}

// Ensure cannedHTTPDoer and errDoer satisfy the HTTPDoer interface.
var (
	_ HTTPDoer = cannedHTTPDoer{}
	_ HTTPDoer = errDoer{}
)
