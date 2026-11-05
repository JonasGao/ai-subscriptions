package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/alibaba-tokenplan.test.ts (26 cases): ACS3 hand-written
// signing and the Token Plan seat-detail usage query. Old tests stub
// globalThis.fetch; here the handler takes an injected HTTPDoer. Subtest
// names keep the old describe/it text so the parity matrix maps case by case.

// ── buildAcsCanonicalQuery ──────────────────────────────────────────────────

func TestBuildAcsCanonicalQuery(t *testing.T) {
	t.Run("sorts params by key and percent-encodes", func(t *testing.T) {
		got := buildAcsCanonicalQuery(map[string]any{
			"WorkspaceId": "ws_test",
			"NamespaceId": "namespace-1",
		})
		const want = "NamespaceId=namespace-1&WorkspaceId=ws_test"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("expands arrays to Key.N=V1 style", func(t *testing.T) {
		got := buildAcsCanonicalQuery(map[string]any{
			"StatusList": []string{"NORMAL", "LIMIT"},
		})
		const want = "StatusList.1=NORMAL&StatusList.2=LIMIT"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("skips undefined and empty values", func(t *testing.T) {
		got := buildAcsCanonicalQuery(map[string]any{
			"WorkspaceId": "ws_test",
			"Empty":       "",
			"Missing":     nil,
			"PageNo":      1,
		})
		const want = "PageNo=1&WorkspaceId=ws_test"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("percent-encodes RFC 3986 reserved chars", func(t *testing.T) {
		got := buildAcsCanonicalQuery(map[string]any{
			"Key": "a+b'c(d)e",
		})
		if !strings.Contains(got, "%") {
			t.Errorf("got %q, expected percent-encoding", got)
		}
		for _, ch := range "!'()*" {
			if strings.ContainsRune(got, ch) {
				t.Errorf("got %q, reserved char %q not escaped", got, ch)
			}
		}
	})
}

// ── signAcsRequest ──────────────────────────────────────────────────────────

func TestSignAcsRequest(t *testing.T) {
	baseConfig := func() AcsSignConfig {
		return AcsSignConfig{
			AccessKeyID:     "test-ak-id",
			AccessKeySecret: "test-ak-secret",
			Action:          "GetSubscriptionSeatDetails",
			Version:         "2026-02-10",
			Body:            "",
			Host:            "modelstudio.cn-beijing.aliyuncs.com",
			Pathname:        "/tokenplan/subscription/seat-detail",
			Method:          "GET",
			QueryString:     "NamespaceId=namespace-1&WorkspaceId=ws_test",
		}
	}

	t.Run("returns all required ACS headers", func(t *testing.T) {
		headers := signAcsRequest(baseConfig())
		if headers["host"] != "modelstudio.cn-beijing.aliyuncs.com" {
			t.Errorf("host = %q", headers["host"])
		}
		if headers["x-acs-action"] != "GetSubscriptionSeatDetails" {
			t.Errorf("x-acs-action = %q", headers["x-acs-action"])
		}
		if headers["x-acs-version"] != "2026-02-10" {
			t.Errorf("x-acs-version = %q", headers["x-acs-version"])
		}
		if !looksLikeISO8601(headers["x-acs-date"]) {
			t.Errorf("x-acs-date = %q, want YYYY-MM-DDTHH:MM:SSZ", headers["x-acs-date"])
		}
		if headers["x-acs-signature-nonce"] == "" {
			t.Errorf("x-acs-signature-nonce empty, want truthy")
		}
		const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
		if headers["x-acs-content-sha256"] != emptyHash {
			t.Errorf("x-acs-content-sha256 = %q, want %q", headers["x-acs-content-sha256"], emptyHash)
		}
		if headers["content-type"] != "application/json" {
			t.Errorf("content-type = %q", headers["content-type"])
		}
		auth := headers["authorization"]
		if !strings.HasPrefix(auth, "ACS3-HMAC-SHA256 Credential=test-ak-id,SignedHeaders=") {
			t.Errorf("authorization prefix = %q", auth)
		}
		sig := signatureSuffix(auth)
		if !looksLikeHex64(sig) {
			t.Errorf("signature = %q, want 64 hex chars", sig)
		}
	})

	t.Run("includes the expected signed headers in the authorization", func(t *testing.T) {
		headers := signAcsRequest(AcsSignConfig{
			AccessKeyID:     "ak",
			AccessKeySecret: "sk",
			Action:          "GetSubscriptionSeatDetails",
			Version:         "2026-02-10",
			Body:            "",
			Host:            "modelstudio.cn-beijing.aliyuncs.com",
			Pathname:        "/tokenplan/subscription/seat-detail",
			Method:          "GET",
			QueryString:     "",
		})
		signed := signedHeadersFromAuth(headers["authorization"])
		want := []string{
			"content-type",
			"host",
			"x-acs-action",
			"x-acs-content-sha256",
			"x-acs-date",
			"x-acs-signature-nonce",
			"x-acs-version",
		}
		if len(signed) != len(want) {
			t.Fatalf("signed = %v, want %v", signed, want)
		}
		for i := range want {
			if signed[i] != want[i] {
				t.Errorf("signed[%d] = %q, want %q (full = %v)", i, signed[i], want[i], signed)
			}
		}
	})

	t.Run("is deterministic when nonce and date are held constant", func(t *testing.T) {
		// Golden values from an independent ACS3 spec reimplementation
		// (Python /tmp/acs3_golden.py). Byte-for-byte signature parity.
		const (
			expectedSignature = "20cd6c162e423d05805c1968c103c9bdb996a7a6af9a0c3ca1cb7db01b3580dd"
			expectedAuth      = "ACS3-HMAC-SHA256 Credential=ak,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=20cd6c162e423d05805c1968c103c9bdb996a7a6af9a0c3ca1cb7db01b3580dd"
		)

		cfg := AcsSignConfig{
			AccessKeyID:     "ak",
			AccessKeySecret: "sk",
			Action:          "GetSubscriptionSeatDetails",
			Version:         "2026-02-10",
			Body:            "",
			Host:            "modelstudio.cn-beijing.aliyuncs.com",
			Pathname:        "/tokenplan/subscription/seat-detail",
			Method:          "GET",
			QueryString:     "WorkspaceId=ws_test",
			DateISO:         "2026-08-11T00:00:00Z",
			Nonce:           "fixed-uuid-for-test",
		}
		a := signAcsRequest(cfg)
		b := signAcsRequest(cfg)

		if a["authorization"] != b["authorization"] {
			t.Errorf("authorization not deterministic:\n%q\n%q", a["authorization"], b["authorization"])
		}
		if a["authorization"] != expectedAuth {
			t.Errorf("authorization =\n  %q\nwant\n  %q", a["authorization"], expectedAuth)
		}
		if a["x-acs-signature-nonce"] != "fixed-uuid-for-test" {
			t.Errorf("nonce = %q, want fixed-uuid-for-test", a["x-acs-signature-nonce"])
		}
		if a["x-acs-date"] != "2026-08-11T00:00:00Z" {
			t.Errorf("date = %q, want 2026-08-11T00:00:00Z", a["x-acs-date"])
		}
		if sig := signatureSuffix(a["authorization"]); sig != expectedSignature {
			t.Errorf("signature = %q, want %q", sig, expectedSignature)
		}
	})

	t.Run("different secret produces different signature", func(t *testing.T) {
		base := AcsSignConfig{
			AccessKeyID: "ak",
			Action:      "A",
			Version:     "V",
			Body:        "",
			Host:        "h",
			Pathname:    "/p",
			Method:      "GET",
			QueryString: "",
			DateISO:     "2026-08-11T00:00:00Z",
			Nonce:       "fixed-uuid",
		}
		a := signAcsRequest(func() AcsSignConfig { c := base; c.AccessKeySecret = "sk-a"; return c }())
		b := signAcsRequest(func() AcsSignConfig { c := base; c.AccessKeySecret = "sk-b"; return c }())

		sigA := signatureSuffix(a["authorization"])
		sigB := signatureSuffix(b["authorization"])
		if sigA == sigB {
			t.Errorf("signatures equal, want different: %q", sigA)
		}
	})
}

// ── FetchTokenPlanUsage ─────────────────────────────────────────────────────

func TestFetchTokenPlanUsage(t *testing.T) {
	baseCreds := map[string]string{"ak": "test-ak", "sk": "test-sk", "workspaceId": "ws_test"}

	t.Run("maps a single 5h equity to fiveHour slot", func(t *testing.T) {
		now := float64(1717000000000)
		body := seatResponse(t, []map[string]any{{
			"SeatId": "seat-1",
			"Status": "NORMAL",
			"EquityList": []map[string]any{{
				"CycleStartTime":    now - 5*3600*1000,
				"CycleEndTime":      now,
				"CycleTotalValue":   1000000,
				"CycleSurplusValue": 700000,
			}},
		}})
		result, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("FetchTokenPlanUsage: %v", err)
		}
		if result.Provider != "alibaba" {
			t.Errorf("provider = %q, want alibaba", result.Provider)
		}
		assertUsageWindow(t, "fiveHour", result.FiveHour, "1000000", "300000", "700000")
		if result.Weekly != nil {
			t.Errorf("weekly = %+v, want nil", result.Weekly)
		}
		if result.Monthly != nil {
			t.Errorf("monthly = %+v, want nil", result.Monthly)
		}
	})

	t.Run("classifies equities into fiveHour/weekly/monthly by cycle duration", func(t *testing.T) {
		now := float64(1717000000000)
		body := seatResponse(t, []map[string]any{{
			"SeatId": "seat-1",
			"Status": "NORMAL",
			"EquityList": []map[string]any{
				{"CycleStartTime": now - 5*3600*1000, "CycleEndTime": now, "CycleTotalValue": 100, "CycleSurplusValue": 50},
				{"CycleStartTime": now - 7*24*3600*1000, "CycleEndTime": now, "CycleTotalValue": 5000, "CycleSurplusValue": 2500},
				{"CycleStartTime": now - 30*24*3600*1000, "CycleEndTime": now, "CycleTotalValue": 20000, "CycleSurplusValue": 10000},
			},
		}})

		result, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("FetchTokenPlanUsage: %v", err)
		}
		assertUsageWindow(t, "fiveHour", result.FiveHour, "100", "50", "50")
		assertUsageWindow(t, "weekly", result.Weekly, "5000", "2500", "2500")
		assertUsageWindow(t, "monthly", result.Monthly, "20000", "10000", "10000")
	})

	t.Run("picks higher-limit equity when multiple map to the same window", func(t *testing.T) {
		now := float64(1717000000000)
		body := seatResponse(t, []map[string]any{
			{
				"SeatId":     "seat-1",
				"EquityList": []map[string]any{{"CycleStartTime": now - 5*3600*1000, "CycleEndTime": now, "CycleTotalValue": 100, "CycleSurplusValue": 80}},
			},
			{
				"SeatId":     "seat-2",
				"EquityList": []map[string]any{{"CycleStartTime": now - 5*3600*1000, "CycleEndTime": now, "CycleTotalValue": 500, "CycleSurplusValue": 400}},
			},
		})

		result, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("FetchTokenPlanUsage: %v", err)
		}
		assertUsageWindow(t, "fiveHour", result.FiveHour, "500", "100", "400")
	})

	t.Run("skips equities with zero/missing CycleTotalValue", func(t *testing.T) {
		now := float64(1717000000000)
		body := seatResponse(t, []map[string]any{{
			"SeatId": "seat-1",
			"EquityList": []map[string]any{
				{"CycleStartTime": now - 5*3600*1000, "CycleEndTime": now, "CycleTotalValue": 0, "CycleSurplusValue": 0},
				{"CycleStartTime": now - 5*3600*1000, "CycleEndTime": now, "CycleSurplusValue": 100},
			},
		}})

		result, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("FetchTokenPlanUsage: %v", err)
		}
		if result.FiveHour != nil || result.Weekly != nil || result.Monthly != nil {
			t.Errorf("windows = (%v, %v, %v), want all nil", result.FiveHour, result.Weekly, result.Monthly)
		}
	})

	t.Run("uses resetTime from CycleEndTime (ms to ISO)", func(t *testing.T) {
		endTime := float64(1717049200000)
		body := seatResponse(t, []map[string]any{{
			"SeatId":     "seat-1",
			"EquityList": []map[string]any{{"CycleStartTime": endTime - 5*3600*1000, "CycleEndTime": endTime, "CycleTotalValue": 1000, "CycleSurplusValue": 500}},
		}})

		result, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("FetchTokenPlanUsage: %v", err)
		}
		if result.FiveHour == nil || result.FiveHour.ResetTime == nil {
			t.Fatalf("fiveHour resetTime = nil, want a value")
		}
		const want = "2024-05-30T06:06:40.000Z"
		if *result.FiveHour.ResetTime != want {
			t.Errorf("resetTime = %q, want %q", *result.FiveHour.ResetTime, want)
		}
	})

	t.Run("returns all-null windows when equity list is empty", func(t *testing.T) {
		body := seatResponse(t, []map[string]any{{"SeatId": "seat-1", "EquityList": []any{}}})
		result, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("FetchTokenPlanUsage: %v", err)
		}
		if result.FiveHour != nil || result.Weekly != nil || result.Monthly != nil {
			t.Errorf("windows = (%v, %v, %v), want all nil", result.FiveHour, result.Weekly, result.Monthly)
		}
	})

	t.Run("throws on missing AK/SK", func(t *testing.T) {
		_, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "", "sk": "sk", "workspaceId": "ws"})
		if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
			t.Errorf("err = %v, want AK/SK not configured", err)
		}
		_, err = FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "ak", "sk": "", "workspaceId": "ws"})
		if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
			t.Errorf("err = %v, want AK/SK not configured", err)
		}
	})

	t.Run("throws on missing WorkspaceId", func(t *testing.T) {
		_, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "ak", "sk": "sk", "workspaceId": ""})
		if err == nil || !strings.Contains(err.Error(), "WorkspaceId not configured") {
			t.Errorf("err = %v, want WorkspaceId not configured", err)
		}
	})

	t.Run("throws on HTTP error", func(t *testing.T) {
		_, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{statusCode: http.StatusForbidden, body: "Forbidden"}, baseCreds)
		if err == nil || !strings.Contains(err.Error(), "TokenPlan usage API returned 403") {
			t.Errorf("err = %v, want 'TokenPlan usage API returned 403'", err)
		}
	})

	t.Run("throws when no seats returned", func(t *testing.T) {
		body := `{"Success":false,"Code":"NoSubscription","Message":"No active subscription","Data":{"Items":[],"Total":0}}`
		_, err := FetchTokenPlanUsage(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err == nil || !strings.Contains(err.Error(), "No active TokenPlan seats") {
			t.Errorf("err = %v, want 'No active TokenPlan seats'", err)
		}
	})

	t.Run("builds the endpoint URL with host override", func(t *testing.T) {
		body := `{"Success":false,"Data":{"Items":[]}}`
		rec := &recordingHTTPDoer{body: body}
		creds := map[string]string{
			"ak":          "test-ak",
			"sk":          "test-sk",
			"workspaceId": "ws_test",
			"host":        "modelstudio.ap-southeast-1.aliyuncs.com",
		}
		_, _ = FetchTokenPlanUsage(context.Background(), rec, creds)

		req := rec.lastRequest()
		if req == nil {
			t.Fatal("no outbound request recorded")
		}
		url := req.URL.String()
		if !strings.HasPrefix(url, "https://modelstudio.ap-southeast-1.aliyuncs.com/tokenplan/subscription/seat-detail?") {
			t.Errorf("url = %q, want https://modelstudio.ap-southeast-1.aliyuncs.com/tokenplan/subscription/seat-detail?", url)
		}
		if !strings.Contains(url, "NamespaceId=namespace-1") || !strings.Contains(url, "WorkspaceId=ws_test") {
			t.Errorf("url %q missing canonical query parameters", url)
		}
	})
}

// ── TestTokenPlanConnection ─────────────────────────────────────────────────

func TestTokenPlanConnection(t *testing.T) {
	baseCreds := map[string]string{"ak": "ak", "sk": "sk", "workspaceId": "ws"}

	t.Run("returns ok:false when AK/SK missing", func(t *testing.T) {
		result, err := testTokenPlanConnection(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "", "sk": "sk", "workspaceId": "ws"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.OK || result.Message != "AK/SK 未配置" {
			t.Errorf("result = %+v, want {ok:false message:AK/SK 未配置}", result)
		}
	})

	t.Run("returns ok:false when WorkspaceId missing", func(t *testing.T) {
		result, err := testTokenPlanConnection(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "ak", "sk": "sk", "workspaceId": ""})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.OK || result.Message != "Workspace ID 未配置" {
			t.Errorf("result = %+v, want {ok:false message:Workspace ID 未配置}", result)
		}
	})

	t.Run("returns ok:true with seat count on success", func(t *testing.T) {
		body := `{"Success":true,"Data":{"Items":[{"SeatId":"s1"}],"Total":3}}`
		result, err := testTokenPlanConnection(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !result.OK || result.Message != "已订阅 (3 个席位)" {
			t.Errorf("result = %+v, want ok + '已订阅 (3 个席位)'", result)
		}
	})

	t.Run("returns ok:false when Total is 0", func(t *testing.T) {
		body := `{"Success":true,"Data":{"Items":[],"Total":0}}`
		result, err := testTokenPlanConnection(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.OK || result.Message != "未检测到 Token Plan 订阅" {
			t.Errorf("result = %+v, want ok:false + '未检测到 Token Plan 订阅'", result)
		}
	})

	t.Run("returns ok:false on HTTP error", func(t *testing.T) {
		result, err := testTokenPlanConnection(context.Background(), cannedHTTPDoer{statusCode: http.StatusInternalServerError, body: ""}, baseCreds)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.OK || result.Message != "API 返回 500" {
			t.Errorf("result = %+v, want ok:false + 'API 返回 500'", result)
		}
	})

	t.Run("returns ok:false on API-level failure", func(t *testing.T) {
		body := `{"Success":false,"Message":"InvalidWorkspaceId"}`
		result, err := testTokenPlanConnection(context.Background(), cannedHTTPDoer{body: body}, baseCreds)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.OK || result.Message != "InvalidWorkspaceId" {
			t.Errorf("result = %+v, want ok:false + 'InvalidWorkspaceId'", result)
		}
	})

	t.Run("returns ok:false on network error", func(t *testing.T) {
		result, err := testTokenPlanConnection(context.Background(), failHTTPDoer{err: context.DeadlineExceeded}, baseCreds)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.OK || result.Message != context.DeadlineExceeded.Error() {
			t.Errorf("result = %+v, want ok:false + network error message", result)
		}
	})
}

// ── UsageHandlers registration ──────────────────────────────────────────────

func TestAlibabaTokenPlanUsageHandlerRegistration(t *testing.T) {
	handlers := UsageHandlers(cannedHTTPDoer{body: `{}`})
	if _, ok := handlers["alibaba:token-plan"]; !ok {
		t.Fatalf("handler 'alibaba:token-plan' not registered; got keys: %v", handlerKeys(handlers))
	}
}

// ── helpers ─────────────────────────────────────────────────────────────────

// seatResponse serializes items as the seat-detail API response. We build the
// response using encoding/json for numeric precision (integer-valued floats
// are emitted without decimals, matching the old stack's JSON semantics).
func seatResponse(t *testing.T, items []map[string]any) string {
	t.Helper()
	payload := map[string]any{
		"Success": true,
		"Data": map[string]any{
			"Items":    items,
			"Total":    len(items),
			"PageNo":   1,
			"PageSize": 10,
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal seat response: %v", err)
	}
	return string(data)
}

// lastRequest returns the most recent request recorded by a recordingHTTPDoer,
// or nil if none.
func (r *recordingHTTPDoer) lastRequest() *http.Request {
	if len(r.requests) == 0 {
		return nil
	}
	return r.requests[len(r.requests)-1]
}

// assertUsageWindow checks limit/used/remaining only (the old test cases that
// use it do not assert resetTime).
func assertUsageWindow(t *testing.T, label string, got *UsageWindow, limit, used, remaining string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want window", label)
	}
	if got.Limit != limit || got.Used != used || got.Remaining != remaining {
		t.Errorf("%s = {limit:%q used:%q remaining:%q}, want {%q %q %q}",
			label, got.Limit, got.Used, got.Remaining, limit, used, remaining)
	}
}

// looksLikeISO8601 reports whether s matches "YYYY-MM-DDTHH:MM:SSZ".
func looksLikeISO8601(s string) bool {
	if len(s) != 20 {
		return false
	}
	return s[4] == '-' && s[7] == '-' && s[10] == 'T' && s[13] == ':' && s[16] == ':' && s[19] == 'Z'
}

// looksLikeHex64 reports whether s is a 64-character lowercase hex string.
func looksLikeHex64(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// signatureSuffix returns the 64-hex-char suffix of an ACS3 authorization
// header ("...Signature=<sig>").
func signatureSuffix(auth string) string {
	const prefix = "Signature="
	idx := strings.LastIndex(auth, prefix)
	if idx < 0 {
		return ""
	}
	return auth[idx+len(prefix):]
}

// signedHeadersFromAuth extracts the SignedHeaders list from an authorization
// header ("...SignedHeaders=a;b;c,...").
func signedHeadersFromAuth(auth string) []string {
	const prefix = "SignedHeaders="
	idx := strings.Index(auth, prefix)
	if idx < 0 {
		return nil
	}
	rest := auth[idx+len(prefix):]
	end := strings.Index(rest, ",")
	if end < 0 {
		return strings.Split(rest, ";")
	}
	return strings.Split(rest[:end], ";")
}

type failHTTPDoer struct{ err error }

func (f failHTTPDoer) Do(*http.Request) (*http.Response, error) { return nil, f.err }

func handlerKeys[K comparable, V any](m map[K]V) []K {
	out := make([]K, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
