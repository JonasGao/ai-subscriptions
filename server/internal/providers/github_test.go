package providers

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// Port of __tests__/github.test.ts (25 cases): GitHub Copilot usage mapping and
// credential testing. The old tests stub global fetch; here handlers take an
// injected HTTPDoer.

// githubDoer exercises the outbound request and records it so URL/header
// assertions can be made without touching package globals.
type githubDoer struct {
	handle   func(*http.Request) (*http.Response, error)
	requests []*http.Request
}

func (d *githubDoer) Do(req *http.Request) (*http.Response, error) {
	d.requests = append(d.requests, req)
	return d.handle(req)
}

func githubHTTPResponse(status int, body string) *http.Response {
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{
		StatusCode: status,
		Status:     httpStatusLine(status),
		Body:       nopCloser(body),
		Header:     make(http.Header),
	}
}

func githubStaticDoer(status int, body string) *githubDoer {
	return &githubDoer{handle: func(*http.Request) (*http.Response, error) {
		return githubHTTPResponse(status, body), nil
	}}
}

// assertGithubWindow compares a usage window; an empty resetTime means nil.
func assertGithubWindow(t *testing.T, label string, got *UsageWindow, limit, used, remaining, resetTime string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want window", label)
	}
	if got.Limit != limit || got.Used != used || got.Remaining != remaining {
		t.Errorf("%s = {limit:%q used:%q remaining:%q}, want {%q %q %q}",
			label, got.Limit, got.Used, got.Remaining, limit, used, remaining)
	}
	if resetTime == "" {
		if got.ResetTime != nil {
			t.Errorf("%s resetTime = %q, want nil", label, *got.ResetTime)
		}
		return
	}
	if got.ResetTime == nil {
		t.Errorf("%s resetTime = nil, want %q", label, resetTime)
	} else if *got.ResetTime != resetTime {
		t.Errorf("%s resetTime = %q, want %q", label, *got.ResetTime, resetTime)
	}
}

func TestGithubUsage(t *testing.T) {
	baseCreds := map[string]string{"token": "ghp_test_token"}

	t.Run("throws when token is missing", func(t *testing.T) {
		for _, credentials := range []map[string]string{{}, {"token": ""}} {
			_, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, "{}"), credentials)
			if err == nil || err.Error() != "Token 未配置" {
				t.Errorf("err = %v, want Token 未配置", err)
			}
		}
	})

	t.Run("maps premium_interactions to monthly window", func(t *testing.T) {
		resetDate := "2026-09-01T00:00:00Z"
		body := `{"quota_snapshots":{"chat":{"entitlement":9999,"remaining":9999},"completions":{"entitlement":9999,"remaining":9999},"premium_interactions":{"entitlement":1000,"remaining":750}},"quota_reset_date":"` + resetDate + `"}`

		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}

		if result.Provider != "github" {
			t.Errorf("provider = %q, want github", result.Provider)
		}
		if result.FiveHour != nil || result.Weekly != nil || result.BoosterWallet != nil || result.Parallel != nil || result.Membership != nil {
			t.Errorf("optional windows = (%v, %v, %v, %v, %v), want all nil",
				result.FiveHour, result.Weekly, result.BoosterWallet, result.Parallel, result.Membership)
		}
		assertGithubWindow(t, "monthly", result.Monthly, "1000", "250", "750", "2026-09-01T00:00:00.000Z")
	})

	t.Run("computes used = entitlement - remaining", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":500,"remaining":100}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		assertGithubWindow(t, "monthly", result.Monthly, "500", "400", "100", "")
	})

	t.Run("clamps used to 0 when remaining exceeds entitlement", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":100,"remaining":200}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		assertGithubWindow(t, "monthly", result.Monthly, "100", "0", "200", "")
	})

	t.Run("treats missing remaining as 0 (used = entitlement)", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":300}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		assertGithubWindow(t, "monthly", result.Monthly, "300", "300", "0", "")
	})

	t.Run("returns monthly = null when premium_interactions is missing", func(t *testing.T) {
		body := `{"quota_snapshots":{"chat":{"entitlement":9999,"remaining":9999}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		if result.Monthly != nil {
			t.Errorf("monthly = %+v, want nil", result.Monthly)
		}
	})

	t.Run("returns monthly = null when quota_snapshots is missing entirely", func(t *testing.T) {
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, `{}`), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		if result.Monthly != nil {
			t.Errorf("monthly = %+v, want nil", result.Monthly)
		}
	})

	t.Run("returns monthly = null when entitlement is 0", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":0,"remaining":0}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		if result.Monthly != nil {
			t.Errorf("monthly = %+v, want nil", result.Monthly)
		}
	})

	t.Run("returns monthly = null when entitlement is negative", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":-5,"remaining":-5}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		if result.Monthly != nil {
			t.Errorf("monthly = %+v, want nil", result.Monthly)
		}
	})

	t.Run("parses numeric quota_reset_date", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":100,"remaining":50}},"quota_reset_date":1759363200000}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		assertGithubWindow(t, "monthly", result.Monthly, "100", "50", "50", "2025-10-02T00:00:00.000Z")
	})

	t.Run("leaves resetTime null when quota_reset_date is absent", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":100,"remaining":50}}}`
		result, err := FetchGithubUsage(context.Background(), githubStaticDoer(0, body), baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}
		if result.Monthly == nil || result.Monthly.ResetTime != nil {
			t.Errorf("monthly.resetTime = %v, want nil", result.Monthly)
		}
	})

	t.Run("throws on non-2xx response", func(t *testing.T) {
		_, err := FetchGithubUsage(context.Background(), githubStaticDoer(http.StatusForbidden, `{"message":"forbidden"}`), baseCreds)
		if err == nil || err.Error() != "Copilot usage API returned 403" {
			t.Errorf("err = %v, want Copilot usage API returned 403", err)
		}
	})

	t.Run("throws on 500 response", func(t *testing.T) {
		_, err := FetchGithubUsage(context.Background(), githubStaticDoer(http.StatusInternalServerError, `{}`), baseCreds)
		if err == nil || err.Error() != "Copilot usage API returned 500" {
			t.Errorf("err = %v, want Copilot usage API returned 500", err)
		}
	})

	t.Run("sends the required headers", func(t *testing.T) {
		client := githubStaticDoer(0, `{"quota_snapshots":{}}`)
		if _, err := FetchGithubUsage(context.Background(), client, baseCreds); err != nil {
			t.Fatalf("FetchGithubUsage: %v", err)
		}

		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != "https://api.github.com/copilot_internal/user" {
			t.Errorf("url = %q", req.URL.String())
		}
		wantHeaders := map[string]string{
			"Authorization":        "token ghp_test_token",
			"Accept":               "application/json",
			"Editor-Version":       "vscode/1.96.2",
			"X-Github-Api-Version": "2025-04-01",
		}
		for key, want := range wantHeaders {
			if got := req.Header.Get(key); got != want {
				t.Errorf("%s = %q, want %q", key, got, want)
			}
		}
	})
}

func TestGithubConnection(t *testing.T) {
	baseCreds := map[string]string{"token": "ghp_test_token"}

	t.Run("returns failure when token is missing", func(t *testing.T) {
		result, err := testGithubConnection(context.Background(), githubStaticDoer(0, `{}`), map[string]string{})
		if err != nil {
			t.Fatalf("testGithubConnection: %v", err)
		}
		if result.OK || result.Message != "Token 未配置" {
			t.Errorf("= %+v, want {false Token 未配置}", result)
		}
	})

	t.Run("returns failure when token is empty string", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(0, `{}`), map[string]string{"token": ""})
		if result.OK || result.Message != "Token 未配置" {
			t.Errorf("= %+v, want {false Token 未配置}", result)
		}
	})

	t.Run("returns success on 200 with quota_snapshots", func(t *testing.T) {
		body := `{"quota_snapshots":{"premium_interactions":{"entitlement":100,"remaining":50}}}`
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(0, body), baseCreds)
		if !result.OK || result.Message != "已配置" {
			t.Errorf("= %+v, want {true 已配置}", result)
		}
	})

	t.Run("returns success on 200 even without premium_interactions", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(0, `{"quota_snapshots":{"chat":{"entitlement":5000}}}`), baseCreds)
		if !result.OK || result.Message != "已配置" {
			t.Errorf("= %+v, want {true 已配置}", result)
		}
	})

	t.Run("returns failure on 401", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(http.StatusUnauthorized, `{"message":"bad credentials"}`), baseCreds)
		if result.OK || result.Message != "Token 无效或已过期" {
			t.Errorf("= %+v, want {false Token 无效或已过期}", result)
		}
	})

	t.Run("returns failure on 403", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(http.StatusForbidden, `{"message":"forbidden"}`), baseCreds)
		if result.OK || result.Message != "接口拒绝请求(可能不支持该 token 类型)" {
			t.Errorf("= %+v, want forbidden-token-type message", result)
		}
	})

	t.Run("returns failure on 404", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(http.StatusNotFound, `{"message":"not found"}`), baseCreds)
		if result.OK || result.Message != "接口拒绝请求(可能不支持该 token 类型)" {
			t.Errorf("= %+v, want forbidden-token-type message", result)
		}
	})

	t.Run("returns failure on other non-2xx status", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(http.StatusInternalServerError, `{}`), baseCreds)
		if result.OK || result.Message != "API 返回 500" {
			t.Errorf("= %+v, want API 返回 500", result)
		}
	})

	t.Run("returns failure when response is missing quota_snapshots", func(t *testing.T) {
		result, _ := testGithubConnection(context.Background(), githubStaticDoer(0, `{}`), baseCreds)
		if result.OK || result.Message != "响应缺少 quota_snapshots" {
			t.Errorf("= %+v, want missing-quota_snapshots message", result)
		}
	})

	t.Run("returns failure on network error", func(t *testing.T) {
		client := &githubDoer{handle: func(*http.Request) (*http.Response, error) {
			return nil, errors.New("ECONNRESET: network down")
		}}
		result, err := testGithubConnection(context.Background(), client, baseCreds)
		if err != nil {
			t.Fatalf("testGithubConnection: %v", err)
		}
		if result.OK || result.Message != "ECONNRESET: network down" {
			t.Errorf("= %+v, want network error message", result)
		}
	})

	t.Run("returns the error message for a non-Error rejection", func(t *testing.T) {
		// Old stack: String(e) for non-Error values. Go errors always carry a
		// message, so the port asserts the same surface text.
		client := &githubDoer{handle: func(*http.Request) (*http.Response, error) {
			return nil, errors.New("weird string error")
		}}
		result, _ := testGithubConnection(context.Background(), client, baseCreds)
		if result.OK || result.Message != "weird string error" {
			t.Errorf("= %+v, want weird string error", result)
		}
	})
}
