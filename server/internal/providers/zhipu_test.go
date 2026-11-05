package providers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/zhipu.test.ts (22 cases) — the ADR-0011 window decoding
// rules. The old tests stub global fetch; here handlers take an injected
// HTTPDoer and assertions target the same normalized UsageResult.

// errorHTTPDoer simulates a transport failure (the old tests' fetch rejection).
type errorHTTPDoer struct{ err error }

func (e errorHTTPDoer) Do(*http.Request) (*http.Response, error) { return nil, e.err }

const zhipuUsageURL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit"

// Real captured sample from the design doc ("实测响应样本").
const zhipuRealFixture = `{
  "code": 200,
  "msg": "Operation successful",
  "data": {
    "limits": [
      {"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":0,"remaining":12000,"percentage":0},
      {"type":"CREDIT_LIMIT","unit":6,"number":1,"usage":60000,"currentValue":0,"remaining":60000,"percentage":0,"nextResetTime":1790302548999}
    ],
    "level": "pro"
  },
  "success": true
}`

func TestFetchZhipuUsage(t *testing.T) {
	creds := map[string]string{"apiKey": "zhipu_test_key"}

	t.Run("maps real fixture to fiveHour + weekly + membership(PRO), monthly null", func(t *testing.T) {
		result, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: zhipuRealFixture}, creds)
		if err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}

		if result.Provider != "zhipu" {
			t.Errorf("provider = %q, want zhipu", result.Provider)
		}
		if result.BoosterWallet != nil || result.Parallel != nil || result.Monthly != nil {
			t.Errorf("optional blocks = (%v, %v, %v), want all nil", result.BoosterWallet, result.Parallel, result.Monthly)
		}

		assertZhipuWindow(t, "fiveHour", result.FiveHour, "12000", "0", "12000")
		if result.FiveHour.ResetTime != nil {
			t.Errorf("fiveHour resetTime = %q, want nil", *result.FiveHour.ResetTime)
		}

		assertZhipuWindow(t, "weekly", result.Weekly, "60000", "0", "60000")
		if result.Weekly.ResetTime == nil || *result.Weekly.ResetTime != "2026-09-25T02:15:48.999Z" {
			t.Errorf("weekly resetTime = %v, want 2026-09-25T02:15:48.999Z", result.Weekly.ResetTime)
		}

		if result.Membership == nil || result.Membership.Level != "PRO" {
			t.Errorf("membership = %+v, want level PRO", result.Membership)
		}
	})

	t.Run("ignores unknown unit rows (warns + warnings) and still maps valid rows", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"CREDIT_LIMIT","unit":9,"number":9,"usage":999,"currentValue":1,"remaining":998},
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":100,"remaining":11900}
		],"level":"pro"},"success":true}`

		result, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}
		assertZhipuWindow(t, "fiveHour", result.FiveHour, "12000", "100", "11900")
		if result.Weekly != nil {
			t.Errorf("weekly = %+v, want nil", result.Weekly)
		}
		if !hasWarning(result.Warnings, "unit=9") {
			t.Errorf("warnings = %v, want one containing unit=9", result.Warnings)
		}
	})

	t.Run("throws when no CREDIT_LIMIT rows decode to known windows", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"TOKENS_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":0,"remaining":12000}
		],"level":"pro"},"success":true}`

		_, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err == nil || err.Error() != "未识别到可用的配额窗口（CREDIT_LIMIT）" {
			t.Errorf("err = %v, want 未识别到可用的配额窗口（CREDIT_LIMIT）", err)
		}
	})

	t.Run("populates warnings for unknown type rows alongside valid rows", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"TOKENS_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":0,"remaining":12000},
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":100,"remaining":11900}
		],"level":"pro"},"success":true}`

		result, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}
		if !hasWarning(result.Warnings, "TOKENS_LIMIT") {
			t.Errorf("warnings = %v, want one containing TOKENS_LIMIT", result.Warnings)
		}
	})

	t.Run("keeps the row with higher limit when two rows claim the same bucket", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":5000,"currentValue":100,"remaining":4900},
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":200,"remaining":11800}
		],"level":"pro"},"success":true}`

		result, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}
		assertZhipuWindow(t, "fiveHour", result.FiveHour, "12000", "200", "11800")
	})

	t.Run("throws when limits is empty", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[],"level":"pro"},"success":true}`
		_, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err == nil || err.Error() != "未检测到 Coding Plan 订阅" {
			t.Errorf("err = %v, want 未检测到 Coding Plan 订阅", err)
		}
	})

	t.Run("throws envelope msg when success is false", func(t *testing.T) {
		body := `{"code":401,"msg":"Invalid authentication key","success":false}`
		_, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err == nil || err.Error() != "Invalid authentication key" {
			t.Errorf("err = %v, want Invalid authentication key", err)
		}
	})

	t.Run("returns membership null when level is absent", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":0,"remaining":12000}
		]},"success":true}`
		result, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}
		if result.Membership != nil {
			t.Errorf("membership = %+v, want nil", result.Membership)
		}
	})

	t.Run("maps currentValue===usage to used===limit (exhausted)", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":12000,"remaining":0}
		],"level":"pro"},"success":true}`
		result, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}
		assertZhipuWindow(t, "fiveHour", result.FiveHour, "12000", "12000", "0")
	})

	t.Run("throws on HTTP non-2xx", func(t *testing.T) {
		_, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{statusCode: http.StatusInternalServerError}, creds)
		if err == nil || err.Error() != "Zhipu usage API returned 500" {
			t.Errorf("err = %v, want Zhipu usage API returned 500", err)
		}
	})

	t.Run("throws when apiKey is missing", func(t *testing.T) {
		for _, credentials := range []map[string]string{{}, {"apiKey": ""}} {
			_, err := FetchZhipuUsage(context.Background(), &recordingHTTPDoer{body: zhipuRealFixture}, credentials)
			if err == nil || err.Error() != "API Key not configured" {
				t.Errorf("err = %v, want API Key not configured", err)
			}
		}
	})

	t.Run("sends bare apiKey in Authorization header (no Bearer prefix)", func(t *testing.T) {
		client := &recordingHTTPDoer{body: zhipuRealFixture}
		if _, err := FetchZhipuUsage(context.Background(), client, creds); err != nil {
			t.Fatalf("FetchZhipuUsage: %v", err)
		}
		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != zhipuUsageURL {
			t.Errorf("url = %q, want %q", req.URL.String(), zhipuUsageURL)
		}
		if got := req.Header.Get("Authorization"); got != "zhipu_test_key" {
			t.Errorf("Authorization = %q, want bare zhipu_test_key", got)
		}
	})
}

func TestZhipuConnectionProbe(t *testing.T) {
	creds := map[string]string{"apiKey": "zhipu_test_key"}

	t.Run("returns failure when apiKey is missing", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{body: zhipuRealFixture}, map[string]string{})
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 未配置"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure when apiKey is empty string", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{body: zhipuRealFixture}, map[string]string{"apiKey": ""})
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 未配置"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns 'API Key 无效' on 401", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{statusCode: http.StatusUnauthorized}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 无效"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns 'API Key 无效' on 403", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{statusCode: http.StatusForbidden}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API Key 无效"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns generic failure on other non-2xx status", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{statusCode: http.StatusInternalServerError}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "API 返回 500"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure on envelope error", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{body: `{"code":400,"msg":"bad request","success":false}`}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "bad request"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure when limits is empty", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{body: `{"code":200,"msg":"ok","data":{"limits":[],"level":"pro"},"success":true}`}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "未检测到 Coding Plan 订阅"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns success with level on valid response", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{body: zhipuRealFixture}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: true, Message: "已连接 (PRO)"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns success without level suffix when level is absent", func(t *testing.T) {
		body := `{"code":200,"msg":"ok","data":{"limits":[
			{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":0,"remaining":12000}
		]},"success":true}`
		result, err := testZhipuConnection(context.Background(), &recordingHTTPDoer{body: body}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: true, Message: "已连接"}) {
			t.Errorf("result = %+v", result)
		}
	})

	t.Run("returns failure on network error", func(t *testing.T) {
		result, err := testZhipuConnection(context.Background(), errorHTTPDoer{err: errors.New("ECONNRESET: network down")}, creds)
		if err != nil {
			t.Fatalf("testZhipuConnection: %v", err)
		}
		if result != (ConnectionResult{OK: false, Message: "ECONNRESET: network down"}) {
			t.Errorf("result = %+v", result)
		}
	})
}

func assertZhipuWindow(t *testing.T, label string, got *UsageWindow, limit, used, remaining string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want window", label)
	}
	if got.Limit != limit || got.Used != used || got.Remaining != remaining {
		t.Errorf("%s = {limit:%q used:%q remaining:%q}, want {%q %q %q}",
			label, got.Limit, got.Used, got.Remaining, limit, used, remaining)
	}
}

func hasWarning(warnings []string, fragment string) bool {
	for _, warning := range warnings {
		if strings.Contains(warning, fragment) {
			return true
		}
	}
	return false
}
