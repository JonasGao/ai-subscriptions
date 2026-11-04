package providers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/providers.test.ts (9 cases): fangzhou agent/coding plan
// and moonshot usage mapping. The old tests stub global fetch; here the
// handler takes an injected HTTPDoer.

type cannedHTTPDoer struct {
	statusCode int
	body       string
}

func (c cannedHTTPDoer) Do(*http.Request) (*http.Response, error) {
	status := c.statusCode
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Body:       io.NopCloser(strings.NewReader(c.body)),
		Header:     make(http.Header),
	}, nil
}

func ptr(s string) *string { return &s }

// httpStatusLine renders "<code> <text>" the way net/http fills Response.Status,
// which the generic models fetcher reports verbatim ("Models query failed: 401
// Unauthorized").
func httpStatusLine(status int) string {
	return fmt.Sprintf("%d %s", status, http.StatusText(status))
}

// nopCloser keeps test fixtures free of an io import at every call site.
func nopCloser(body string) io.ReadCloser {
	return io.NopCloser(strings.NewReader(body))
}

func assertWindow(t *testing.T, label string, got *UsageWindow, limit, used, remaining, resetTime string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want window", label)
	}
	if got.Limit != limit || got.Used != used || got.Remaining != remaining {
		t.Errorf("%s = {limit:%q used:%q remaining:%q}, want {%q %q %q}",
			label, got.Limit, got.Used, got.Remaining, limit, used, remaining)
	}
	if got.ResetTime == nil {
		t.Errorf("%s resetTime = nil, want %q", label, resetTime)
	} else if *got.ResetTime != resetTime {
		t.Errorf("%s resetTime = %q, want %q", label, *got.ResetTime, resetTime)
	}
}

func TestAgentPlanUsage(t *testing.T) {
	t.Run("maps AgentPlan flat Result object to UsageResult", func(t *testing.T) {
		// Fixture lifted verbatim from the old test.
		body := `{"Result":{"PlanType":"medium","AFPFiveHour":{"Quota":1000,"Used":250,"SubscribeTime":1717049200000,"ResetTime":1717049200000},"AFPWeekly":{"Quota":50000,"Used":12500,"SubscribeTime":1717625200000,"ResetTime":1717625200000},"AFPMonthly":{"Quota":200000,"Used":50000,"SubscribeTime":1719615600000,"ResetTime":1719615600000},"AFPDaily":{"Quota":50000,"Used":1683,"SubscribeTime":1717000000000,"ResetTime":1717000000000}}}`

		result, err := FetchAgentPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "test-ak", "sk": "test-sk"})
		if err != nil {
			t.Fatalf("FetchAgentPlanUsage: %v", err)
		}
		if result.Provider != "fangzhou" {
			t.Errorf("provider = %q, want fangzhou", result.Provider)
		}

		assertWindow(t, "fiveHour", result.FiveHour, "1000", "250", "750", "2024-05-30T06:06:40.000Z")
		assertWindow(t, "weekly", result.Weekly, "50000", "12500", "37500", "2024-06-05T22:06:40.000Z")
		assertWindow(t, "monthly", result.Monthly, "200000", "50000", "150000", "2024-06-28T23:00:00.000Z")

		if result.BoosterWallet != nil || result.Parallel != nil || result.Membership != nil {
			t.Errorf("optional blocks = (%v, %v, %v), want all nil", result.BoosterWallet, result.Parallel, result.Membership)
		}
	})

	t.Run("throws when not subscribed", func(t *testing.T) {
		_, err := FetchAgentPlanUsage(context.Background(), cannedHTTPDoer{body: `{"Result":null}`}, map[string]string{"ak": "a", "sk": "s"})
		if err == nil || !strings.Contains(err.Error(), "Account not subscribed") {
			t.Errorf("err = %v, want containing \"Account not subscribed\"", err)
		}
	})

	t.Run("throws on HTTP error", func(t *testing.T) {
		_, err := FetchAgentPlanUsage(context.Background(), cannedHTTPDoer{statusCode: http.StatusForbidden, body: "Forbidden"}, map[string]string{"ak": "a", "sk": "s"})
		if err == nil || !strings.Contains(err.Error(), "AgentPlan usage API returned 403") {
			t.Errorf("err = %v, want containing \"AgentPlan usage API returned 403\"", err)
		}
	})
}

func TestCodingPlanUsage(t *testing.T) {
	t.Run("maps CodingPlan QuotaUsage (Level, Percent, Cap) to UsageResult", func(t *testing.T) {
		body := `{"Result":{"Status":"Running","UpdateTimestamp":1717000000,"QuotaUsage":[{"Level":"session","Percent":30,"ResetTimestamp":1717049200,"Cap":100,"RewardTotalPercent":0},{"Level":"weekly","Percent":45,"ResetTimestamp":1717625200,"Cap":100,"RewardTotalPercent":0},{"Level":"monthly","Percent":60,"ResetTimestamp":1719615600,"Cap":100,"RewardTotalPercent":0}],"HasReward":false}}`

		result, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "test-ak", "sk": "test-sk"})
		if err != nil {
			t.Fatalf("FetchCodingPlanUsage: %v", err)
		}
		if result.Provider != "fangzhou" {
			t.Errorf("provider = %q, want fangzhou", result.Provider)
		}

		// session → fiveHour (percent → used, Cap → limit)
		assertWindow(t, "fiveHour", result.FiveHour, "100", "30", "70", "2024-05-30T06:06:40.000Z")
		assertWindow(t, "weekly", result.Weekly, "100", "45", "55", "2024-06-05T22:06:40.000Z")
		assertWindow(t, "monthly", result.Monthly, "100", "60", "40", "2024-06-28T23:00:00.000Z")
	})

	t.Run("throws when QuotaUsage is empty", func(t *testing.T) {
		_, err := FetchCodingPlanUsage(context.Background(), cannedHTTPDoer{body: `{"Result":{"QuotaUsage":[]}}`}, map[string]string{"ak": "a", "sk": "s"})
		if err == nil || !strings.Contains(err.Error(), "Account not subscribed") {
			t.Errorf("err = %v, want containing \"Account not subscribed\"", err)
		}
	})
}

func TestMoonshotUsage(t *testing.T) {
	const usageURL = "https://api.kimi.com/coding/v1/usages"

	t.Run("maps usage → weekly and the 5h (300min) limit → fiveHour", func(t *testing.T) {
		body := `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2026-03-04T04:01:38Z"},"limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"200","used":"7","remaining":"193","resetTime":"2026-03-03T11:16:04Z"}}],"user":{"userId":"u1","region":"REGION_OVERSEA","membership":{"level":"LEVEL_BASIC"},"businessId":""}}`

		result, err := FetchMoonshotUsage(context.Background(), cannedHTTPDoer{body: body}, "test-key", usageURL)
		if err != nil {
			t.Fatalf("FetchMoonshotUsage: %v", err)
		}
		if result.Provider != "moonshot" {
			t.Errorf("provider = %q, want moonshot", result.Provider)
		}

		assertWindow(t, "weekly", result.Weekly, "1024", "100", "924", "2026-03-04T04:01:38Z")
		assertWindow(t, "fiveHour", result.FiveHour, "200", "7", "193", "2026-03-03T11:16:04Z")

		if result.Monthly != nil {
			t.Errorf("monthly = %+v, want nil", result.Monthly)
		}
		if result.Membership == nil || result.Membership.Level != "LEVEL_BASIC" {
			t.Errorf("membership = %+v, want LEVEL_BASIC", result.Membership)
		}
	})

	t.Run("ignores limits that are not 5-hour or monthly windows", func(t *testing.T) {
		body := `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2026-03-04T04:01:38Z"},"limits":[{"window":{"duration":60,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"200","used":"7","remaining":"193","resetTime":"2026-03-03T11:16:04Z"}}]}`

		result, err := FetchMoonshotUsage(context.Background(), cannedHTTPDoer{body: body}, "test-key", usageURL)
		if err != nil {
			t.Fatalf("FetchMoonshotUsage: %v", err)
		}
		if result.FiveHour != nil || result.Monthly != nil {
			t.Errorf("fiveHour/monthly = (%v, %v), want both nil", result.FiveHour, result.Monthly)
		}
		if result.Weekly == nil {
			t.Error("weekly = nil, want window")
		}
	})

	t.Run("derives remaining when omitted (quota fully used)", func(t *testing.T) {
		body := `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2026-03-04T04:01:38Z"},"limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"200","used":"200","resetTime":"2026-03-03T11:16:04Z"}}]}`

		result, err := FetchMoonshotUsage(context.Background(), cannedHTTPDoer{body: body}, "test-key", usageURL)
		if err != nil {
			t.Fatalf("FetchMoonshotUsage: %v", err)
		}
		assertWindow(t, "fiveHour", result.FiveHour, "200", "200", "0", "2026-03-03T11:16:04Z")
	})

	t.Run("returns null when both used and remaining are missing", func(t *testing.T) {
		body := `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2026-03-04T04:01:38Z"},"limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"200","resetTime":"2026-03-03T11:16:04Z"}}]}`

		result, err := FetchMoonshotUsage(context.Background(), cannedHTTPDoer{body: body}, "test-key", usageURL)
		if err != nil {
			t.Fatalf("FetchMoonshotUsage: %v", err)
		}
		if result.FiveHour != nil {
			t.Errorf("fiveHour = %+v, want nil", result.FiveHour)
		}
	})
}
