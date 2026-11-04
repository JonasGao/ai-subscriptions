package providers

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// Port of __tests__/opencode.test.ts (23 cases): OpenCode Go quota windows are
// synthesized from percent (limit fixed at 100), rate-limited forces 100, and a
// 401 with error.code api_key_expired gets the dedicated expired-key message.

const opencodeUsageURL = "https://opencode.ai/zen/go/v1/usage"

const opencodeRealFixture = `{
  "usage": {
    "rolling": {"status":"ok","percent":0,"resetsAt":"2026-09-13T11:26:17.325Z"},
    "weekly": {"status":"ok","percent":23,"resetsAt":"2026-09-14T00:00:00.325Z"},
    "monthly": {"status":"ok","percent":11,"resetsAt":"2026-10-10T11:03:46.325Z"}
  }
}`

func TestFetchOpencodeGoUsage(t *testing.T) {
	creds := map[string]string{"apiKey": "oc_test_key"}

	t.Run("throws when apiKey is missing", func(t *testing.T) {
		for _, credentials := range []map[string]string{{}, {"apiKey": ""}} {
			_, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: opencodeRealFixture}, credentials)
			if err == nil || err.Error() != "API Key 未配置" {
				t.Errorf("err = %v, want API Key 未配置", err)
			}
		}
	})

	t.Run("synthesizes real fixture into three windows", func(t *testing.T) {
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: opencodeRealFixture}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}

		if result.Provider != "opencode" {
			t.Errorf("provider = %q, want opencode", result.Provider)
		}
		if result.BoosterWallet != nil || result.Parallel != nil || result.Membership != nil {
			t.Errorf("optional blocks = (%v, %v, %v), want all nil", result.BoosterWallet, result.Parallel, result.Membership)
		}

		assertOpencodeWindow(t, "fiveHour", result.FiveHour, "0", "100", "2026-09-13T11:26:17.325Z")
		assertOpencodeWindow(t, "weekly", result.Weekly, "23", "77", "2026-09-14T00:00:00.325Z")
		assertOpencodeWindow(t, "monthly", result.Monthly, "11", "89", "2026-10-10T11:03:46.325Z")
	})

	t.Run("maps rolling to fiveHour bucket", func(t *testing.T) {
		body := `{"usage":{"rolling":{"status":"ok","percent":50,"resetsAt":"2026-09-13T12:00:00Z"}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		assertOpencodeWindow(t, "fiveHour", result.FiveHour, "50", "50", "2026-09-13T12:00:00Z")
		if result.Weekly != nil || result.Monthly != nil {
			t.Errorf("weekly/monthly = (%v, %v), want nil", result.Weekly, result.Monthly)
		}
	})

	t.Run("returns null windows when only weekly exists", func(t *testing.T) {
		body := `{"usage":{"weekly":{"status":"ok","percent":42,"resetsAt":"2026-09-14T00:00:00Z"}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		if result.FiveHour != nil || result.Monthly != nil {
			t.Errorf("fiveHour/monthly = (%v, %v), want nil", result.FiveHour, result.Monthly)
		}
		assertOpencodeWindow(t, "weekly", result.Weekly, "42", "58", "2026-09-14T00:00:00Z")
	})

	t.Run("rate-limited + percent<100 forces used=100, remaining=0", func(t *testing.T) {
		body := `{"usage":{"rolling":{"status":"rate-limited","percent":60,"resetsAt":"2026-09-13T12:00:00Z"}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		assertOpencodeWindow(t, "fiveHour", result.FiveHour, "100", "0", "2026-09-13T12:00:00Z")
	})

	t.Run("rate-limited + percent>100 preserves overage", func(t *testing.T) {
		body := `{"usage":{"weekly":{"status":"rate-limited","percent":105,"resetsAt":"2026-09-14T00:00:00Z"}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		assertOpencodeWindow(t, "weekly", result.Weekly, "105", "0", "2026-09-14T00:00:00Z")
	})

	t.Run("percent>100 without rate-limited preserves overage, not clamped", func(t *testing.T) {
		body := `{"usage":{"monthly":{"status":"ok","percent":105,"resetsAt":"2026-10-10T11:00:00Z"}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		assertOpencodeWindow(t, "monthly", result.Monthly, "105", "0", "2026-10-10T11:00:00Z")
	})

	t.Run("missing percent defaults to 0", func(t *testing.T) {
		body := `{"usage":{"rolling":{"status":"ok","resetsAt":"2026-09-13T12:00:00Z"}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		assertOpencodeWindow(t, "fiveHour", result.FiveHour, "0", "100", "2026-09-13T12:00:00Z")
	})

	t.Run("missing resetsAt yields resetTime null", func(t *testing.T) {
		body := `{"usage":{"rolling":{"status":"ok","percent":10}}}`
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		if result.FiveHour == nil {
			t.Fatal("fiveHour = nil, want window")
		}
		if result.FiveHour.ResetTime != nil {
			t.Errorf("resetTime = %q, want nil", *result.FiveHour.ResetTime)
		}
	})

	t.Run("empty usage yields all windows null", func(t *testing.T) {
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: `{"usage":{}}`}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		if result.FiveHour != nil || result.Weekly != nil || result.Monthly != nil {
			t.Errorf("windows = (%v, %v, %v), want all nil", result.FiveHour, result.Weekly, result.Monthly)
		}
	})

	t.Run("missing usage key yields all windows null", func(t *testing.T) {
		result, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{body: `{}`}, creds)
		if err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		if result.FiveHour != nil || result.Weekly != nil || result.Monthly != nil {
			t.Errorf("windows = (%v, %v, %v), want all nil", result.FiveHour, result.Weekly, result.Monthly)
		}
	})

	t.Run("throws on 401", func(t *testing.T) {
		_, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{statusCode: http.StatusUnauthorized, body: `{"message":"unauthorized"}`}, creds)
		if err == nil || err.Error() != "API Key 无效或未配置" {
			t.Errorf("err = %v, want API Key 无效或未配置", err)
		}
	})

	t.Run("throws expired-key message on 401 with api_key_expired code", func(t *testing.T) {
		body := `{"error":{"type":"authentication_error","code":"api_key_expired","message":"This API key has expired."}}`
		_, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{statusCode: http.StatusUnauthorized, body: body}, creds)
		if err == nil || err.Error() != "API Key 已过期，请到 OpenCode Console 创建新 Key 并更新订阅凭据（重新登录不会续期）" {
			t.Errorf("err = %v, want expired-key message", err)
		}
	})

	t.Run("throws on other non-2xx status", func(t *testing.T) {
		_, err := FetchOpencodeGoUsage(context.Background(), &recordingHTTPDoer{statusCode: http.StatusInternalServerError}, creds)
		if err == nil || err.Error() != "API 返回 500" {
			t.Errorf("err = %v, want API 返回 500", err)
		}
	})

	t.Run("sends correct URL and Bearer header", func(t *testing.T) {
		client := &recordingHTTPDoer{body: `{"usage":{}}`}
		if _, err := FetchOpencodeGoUsage(context.Background(), client, creds); err != nil {
			t.Fatalf("FetchOpencodeGoUsage: %v", err)
		}
		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != opencodeUsageURL {
			t.Errorf("url = %q, want %q", req.URL.String(), opencodeUsageURL)
		}
		if got := req.Header.Get("Authorization"); got != "Bearer oc_test_key" {
			t.Errorf("Authorization = %q, want Bearer oc_test_key", got)
		}
		if got := req.Header.Get("Accept"); got != "application/json" {
			t.Errorf("Accept = %q, want application/json", got)
		}
	})
}

func TestOpencodeConnectionProbe(t *testing.T) {
	creds := map[string]string{"apiKey": "oc_test_key"}

	t.Run("returns failure when apiKey is missing", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), &recordingHTTPDoer{body: `{"usage":{}}`}, map[string]string{})
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 未配置"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure when apiKey is empty string", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), &recordingHTTPDoer{body: `{"usage":{}}`}, map[string]string{"apiKey": ""})
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 未配置"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns success on 200", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), &recordingHTTPDoer{body: `{"usage":{}}`}, creds)
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: true, Message: "已配置"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure on 401", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), &recordingHTTPDoer{statusCode: http.StatusUnauthorized}, creds)
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 无效或未配置"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns expired-key message on 401 with api_key_expired code", func(t *testing.T) {
		body := `{"error":{"type":"authentication_error","code":"api_key_expired"}}`
		result, err := testOpencodeConnection(context.Background(), &recordingHTTPDoer{statusCode: http.StatusUnauthorized, body: body}, creds)
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		want := "API Key 已过期，请到 OpenCode Console 创建新 Key 并更新订阅凭据（重新登录不会续期）"
		if result != (ConnectionResult{OK: false, Message: want}) {
			t.Errorf("result = %+v, want message %q", result, want)
		}
	})

	t.Run("returns failure on other non-2xx status", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), &recordingHTTPDoer{statusCode: http.StatusInternalServerError}, creds)
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API 返回 500"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure on network error", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), errorHTTPDoer{err: errors.New("ECONNRESET: network down")}, creds)
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "ECONNRESET: network down"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure with stringified error when error is not an Error", func(t *testing.T) {
		result, err := testOpencodeConnection(context.Background(), errorHTTPDoer{err: errors.New("weird string error")}, creds)
		if err != nil {
			t.Fatalf("testOpencodeConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "weird string error"}) {
			t.Errorf("result = %+v", result)
		}
	})
}

func assertOpencodeWindow(t *testing.T, label string, got *UsageWindow, used, remaining, resetTime string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want window", label)
	}
	if got.Limit != "100" || got.Used != used || got.Remaining != remaining {
		t.Errorf("%s = {limit:%q used:%q remaining:%q}, want {100 %q %q}",
			label, got.Limit, got.Used, got.Remaining, used, remaining)
	}
	if got.ResetTime == nil || *got.ResetTime != resetTime {
		t.Errorf("%s resetTime = %v, want %q", label, got.ResetTime, resetTime)
	}
}
