package notify

// Parity port of __tests__/feishu-app.test.ts (21 cases). The old module kept a
// module-level tenant_access_token cache keyed by appId, refilled once when
// Feishu reports an invalid token (HTTP 401 or code 99991663), and rendered the
// notification as an interactive card. The cases below pin the cache
// lifecycle, the card shape, the retry and the channel→sender routing.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"ai-subscriptions/internal/model"
)

// fakeTransport records requests and replays scripted responses, so a case can
// assert on the wire without a live Feishu tenant.
type fakeTransport struct {
	mu        sync.Mutex
	requests  []recordedHTTPRequest
	responses []fakeResponse
	calls     int
}

type recordedHTTPRequest struct {
	method string
	url    string
	header http.Header
	body   string
}

type fakeResponse struct {
	status int
	body   string
}

func (f *fakeTransport) Do(req *http.Request) (*http.Response, error) {
	var payload string
	if req.Body != nil {
		raw, _ := io.ReadAll(req.Body)
		payload = string(raw)
	}

	f.mu.Lock()
	f.requests = append(f.requests, recordedHTTPRequest{
		method: req.Method,
		url:    req.URL.String(),
		header: req.Header.Clone(),
		body:   payload,
	})
	index := f.calls
	f.calls++
	var response fakeResponse
	if index < len(f.responses) {
		response = f.responses[index]
	} else {
		response = fakeResponse{status: http.StatusOK, body: `{"code":0}`}
	}
	f.mu.Unlock()

	status := response.status
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, strings.ToLower(http.StatusText(status))),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(response.body)),
	}, nil
}

func (f *fakeTransport) request(t *testing.T, index int) recordedHTTPRequest {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if index >= len(f.requests) {
		t.Fatalf("request %d not made, only %d recorded", index, len(f.requests))
	}
	return f.requests[index]
}

func (f *fakeTransport) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func tokenOK(token string) fakeResponse {
	return fakeResponse{body: `{"code":0,"tenant_access_token":"` + token + `","expire":7200}`}
}

func sendOK() fakeResponse {
	return fakeResponse{body: `{"code":0,"msg":"success"}`}
}

// feishuClientFor builds a client with a fixed clock and the scripted transport.
func feishuClientFor(transport *fakeTransport, nowMs *int64) *FeishuClient {
	client := NewFeishuClient(transport, func() time.Time {
		return time.UnixMilli(*nowMs)
	})
	return client
}

func lowBalanceEventFixture() Event {
	balance := 5.0
	return Event{
		Kind: "low-balance",
		Subscription: model.Subscription{
			ID:               "sub-1",
			Name:             "Claude Pro",
			Category:         "AI助手",
			Provider:         "anthropic",
			SubscriptionType: "one-time",
			Price:            20,
			Status:           "active",
			Balance:          &balance,
		},
		Balance:     5,
		Threshold:   10,
		TriggeredAt: "2024-06-01T00:00:00Z",
	}
}

func resetEventFixture() Event {
	balance := 5.0
	return Event{
		Kind: "reset",
		Subscription: model.Subscription{
			ID:               "sub-1",
			Name:             "Claude Pro",
			Category:         "AI助手",
			Provider:         "anthropic",
			SubscriptionType: "one-time",
			Price:            20,
			Status:           "active",
			Balance:          &balance,
		},
		ScheduleType:  "weekly",
		NextResetTime: "2024-06-08T00:00:00Z",
		TriggeredAt:   "2024-06-01T00:00:00Z",
	}
}

func feishuCredsFixture() FeishuAppCredentials {
	return FeishuAppCredentials{
		AppID:         "app-id",
		AppSecret:     "app-secret",
		ReceiveID:     "ou_xxx",
		ReceiveIDType: "open_id",
	}
}

// ---------- token cache (9 cases) ----------

func TestFeishuTenantTokenFetchesOnFirstCall(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token-1")}}
	client := feishuClientFor(transport, &nowMs)

	token, err := client.TenantToken(context.Background(), "app-id", "app-secret", false)
	if err != nil {
		t.Fatalf("TenantToken: %v", err)
	}
	if token != "t-token-1" {
		t.Errorf("token = %q, want t-token-1", token)
	}
	if transport.callCount() != 1 {
		t.Fatalf("calls = %d, want 1", transport.callCount())
	}

	request := transport.request(t, 0)
	if request.url != "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" {
		t.Errorf("url = %q, want the tenant token endpoint", request.url)
	}
	if request.method != http.MethodPost {
		t.Errorf("method = %q, want POST", request.method)
	}
	var body map[string]string
	if err := json.Unmarshal([]byte(request.body), &body); err != nil {
		t.Fatalf("decode body %q: %v", request.body, err)
	}
	if body["app_id"] != "app-id" || body["app_secret"] != "app-secret" {
		t.Errorf("body = %v, want app_id/app_secret", body)
	}
}

func TestFeishuTenantTokenReturnsCachedTokenWithinExpiry(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token-1")}}
	client := feishuClientFor(transport, &nowMs)

	if _, err := client.TenantToken(context.Background(), "app-id", "app-secret", false); err != nil {
		t.Fatalf("first TenantToken: %v", err)
	}
	nowMs += 1000
	token, err := client.TenantToken(context.Background(), "app-id", "app-secret", false)
	if err != nil {
		t.Fatalf("second TenantToken: %v", err)
	}
	if token != "t-token-1" {
		t.Errorf("token = %q, want the cached t-token-1", token)
	}
	if transport.callCount() != 1 {
		t.Errorf("calls = %d, want 1 (cache hit)", transport.callCount())
	}
}

func TestFeishuTenantTokenRefreshesAfterExpiryBuffer(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token-1"), tokenOK("t-token-2")}}
	client := feishuClientFor(transport, &nowMs)

	if _, err := client.TenantToken(context.Background(), "app-id", "app-secret", false); err != nil {
		t.Fatalf("first TenantToken: %v", err)
	}
	nowMs += 7200 * 1000
	token, err := client.TenantToken(context.Background(), "app-id", "app-secret", false)
	if err != nil {
		t.Fatalf("second TenantToken: %v", err)
	}
	if token != "t-token-2" {
		t.Errorf("token = %q, want the refreshed t-token-2", token)
	}
	if transport.callCount() != 2 {
		t.Errorf("calls = %d, want 2", transport.callCount())
	}
}

func TestFeishuTenantTokenForceRefreshBypassesCache(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token-1"), tokenOK("t-token-2")}}
	client := feishuClientFor(transport, &nowMs)

	if _, err := client.TenantToken(context.Background(), "app-id", "app-secret", false); err != nil {
		t.Fatalf("first TenantToken: %v", err)
	}
	token, err := client.TenantToken(context.Background(), "app-id", "app-secret", true)
	if err != nil {
		t.Fatalf("forced TenantToken: %v", err)
	}
	if token != "t-token-2" {
		t.Errorf("token = %q, want the forced t-token-2", token)
	}
	if transport.callCount() != 2 {
		t.Errorf("calls = %d, want 2", transport.callCount())
	}
}

func TestFeishuTenantTokenRejectsNonZeroCode(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		{body: `{"code":10003,"msg":"invalid app_id"}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	_, err := client.TenantToken(context.Background(), "bad", "bad", false)
	if err == nil || !strings.Contains(err.Error(), "code=10003") {
		t.Fatalf("err = %v, want it to carry code=10003", err)
	}
}

func TestFeishuTenantTokenRejectsHTTPFailure(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		{status: http.StatusInternalServerError, body: "server error"},
	}}
	client := feishuClientFor(transport, &nowMs)

	_, err := client.TenantToken(context.Background(), "app-id", "app-secret", false)
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("err = %v, want it to carry HTTP 500", err)
	}
}

func TestFeishuTenantTokenCachesPerAppID(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("token-app1"), tokenOK("token-app2")}}
	client := feishuClientFor(transport, &nowMs)

	token1, err := client.TenantToken(context.Background(), "app-1", "secret-1", false)
	if err != nil {
		t.Fatalf("app-1 token: %v", err)
	}
	if token1 != "token-app1" {
		t.Errorf("app-1 token = %q, want token-app1", token1)
	}

	token2, err := client.TenantToken(context.Background(), "app-2", "secret-2", false)
	if err != nil {
		t.Fatalf("app-2 token: %v", err)
	}
	if token2 != "token-app2" {
		t.Errorf("app-2 token = %q, want token-app2 (separate cache)", token2)
	}

	again, err := client.TenantToken(context.Background(), "app-1", "secret-1", false)
	if err != nil {
		t.Fatalf("app-1 cached token: %v", err)
	}
	if again != "token-app1" {
		t.Errorf("app-1 token = %q, want the cached token-app1", again)
	}
	if transport.callCount() != 2 {
		t.Errorf("calls = %d, want 2", transport.callCount())
	}
}

func TestFeishuClearTokenCacheClearsOneApp(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("token-app1-v1"), tokenOK("token-app2-v1"), tokenOK("token-app1-v2"),
	}}
	client := feishuClientFor(transport, &nowMs)

	if _, err := client.TenantToken(context.Background(), "app-1", "secret-1", false); err != nil {
		t.Fatalf("app-1 token: %v", err)
	}
	if _, err := client.TenantToken(context.Background(), "app-2", "secret-2", false); err != nil {
		t.Fatalf("app-2 token: %v", err)
	}
	client.ClearTokenCache("app-1")

	token1, err := client.TenantToken(context.Background(), "app-1", "secret-1", false)
	if err != nil {
		t.Fatalf("app-1 refreshed token: %v", err)
	}
	if token1 != "token-app1-v2" {
		t.Errorf("app-1 token = %q, want the refetched token-app1-v2", token1)
	}
	token2, err := client.TenantToken(context.Background(), "app-2", "secret-2", false)
	if err != nil {
		t.Fatalf("app-2 cached token: %v", err)
	}
	if token2 != "token-app2-v1" {
		t.Errorf("app-2 token = %q, want the untouched token-app2-v1", token2)
	}
	if transport.callCount() != 3 {
		t.Errorf("calls = %d, want 3", transport.callCount())
	}
}

func TestFeishuClearTokenCacheClearsAll(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("token-app1-v1"), tokenOK("token-app2-v1"),
		tokenOK("token-app1-v2"), tokenOK("token-app2-v2"),
	}}
	client := feishuClientFor(transport, &nowMs)

	if _, err := client.TenantToken(context.Background(), "app-1", "secret-1", false); err != nil {
		t.Fatalf("app-1 token: %v", err)
	}
	if _, err := client.TenantToken(context.Background(), "app-2", "secret-2", false); err != nil {
		t.Fatalf("app-2 token: %v", err)
	}
	client.ClearTokenCache("")

	token1, err := client.TenantToken(context.Background(), "app-1", "secret-1", false)
	if err != nil {
		t.Fatalf("app-1 refreshed token: %v", err)
	}
	token2, err := client.TenantToken(context.Background(), "app-2", "secret-2", false)
	if err != nil {
		t.Fatalf("app-2 refreshed token: %v", err)
	}
	if token1 != "token-app1-v2" || token2 != "token-app2-v2" {
		t.Errorf("tokens = %q/%q, want both refetched", token1, token2)
	}
	if transport.callCount() != 4 {
		t.Errorf("calls = %d, want 4", transport.callCount())
	}
}

// ---------- card payload (3 cases) ----------

func TestBuildFeishuAppCardRendersLowBalance(t *testing.T) {
	card, err := BuildFeishuAppCard(lowBalanceEventFixture())
	if err != nil {
		t.Fatalf("BuildFeishuAppCard: %v", err)
	}

	var decoded struct {
		Header struct {
			Title struct {
				Tag     string `json:"tag"`
				Content string `json:"content"`
			} `json:"title"`
		} `json:"header"`
		Elements []struct {
			Tag     string `json:"tag"`
			Content string `json:"content"`
		} `json:"elements"`
	}
	if err := json.Unmarshal([]byte(card), &decoded); err != nil {
		t.Fatalf("decode card %q: %v", card, err)
	}

	if decoded.Header.Title.Tag != "plain_text" {
		t.Errorf("title tag = %q, want plain_text", decoded.Header.Title.Tag)
	}
	if !strings.Contains(decoded.Header.Title.Content, "Claude Pro") {
		t.Errorf("title = %q, want it to name the subscription", decoded.Header.Title.Content)
	}
	if !strings.Contains(decoded.Header.Title.Content, "余额不足") {
		t.Errorf("title = %q, want the low-balance label", decoded.Header.Title.Content)
	}
	if len(decoded.Elements) != 1 || decoded.Elements[0].Tag != "markdown" {
		t.Fatalf("elements = %+v, want one markdown block", decoded.Elements)
	}
	if !strings.Contains(decoded.Elements[0].Content, "Claude Pro") ||
		!strings.Contains(decoded.Elements[0].Content, "当前余额") {
		t.Errorf("markdown = %q, want the subscription and balance lines", decoded.Elements[0].Content)
	}
}

func TestBuildFeishuAppCardRendersReset(t *testing.T) {
	card, err := BuildFeishuAppCard(resetEventFixture())
	if err != nil {
		t.Fatalf("BuildFeishuAppCard: %v", err)
	}
	if !strings.Contains(card, "配额已重置") {
		t.Errorf("card = %q, want the reset label", card)
	}
	if !strings.Contains(card, "重置计划") {
		t.Errorf("card = %q, want the schedule line", card)
	}
}

func TestBuildFeishuAppCardOmitsKeywordTitle(t *testing.T) {
	// feishu-app authenticates with credentials, so keyword security is off and
	// the title must not carry the 【AI订阅】 prefix webhook channels use.
	card, err := BuildFeishuAppCard(lowBalanceEventFixture())
	if err != nil {
		t.Fatalf("BuildFeishuAppCard: %v", err)
	}
	if strings.Contains(card, "【AI订阅】") {
		t.Errorf("card = %q, want no keyword prefix", card)
	}
}

// ---------- send with retry (5 cases) ----------

func TestSendFeishuAppMessageUsesFetchedToken(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token-1"), sendOK()}}
	client := feishuClientFor(transport, &nowMs)

	if err := client.Send(context.Background(), lowBalanceEventFixture(), feishuCredsFixture()); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if transport.callCount() != 2 {
		t.Fatalf("calls = %d, want 2 (token + send)", transport.callCount())
	}

	send := transport.request(t, 1)
	if send.url != "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id" {
		t.Errorf("url = %q, want the messages endpoint with receive_id_type", send.url)
	}
	if send.header.Get("Authorization") != "Bearer t-token-1" {
		t.Errorf("Authorization = %q, want the fetched token", send.header.Get("Authorization"))
	}
	var body struct {
		ReceiveID string `json:"receive_id"`
		MsgType   string `json:"msg_type"`
		Content   string `json:"content"`
	}
	if err := json.Unmarshal([]byte(send.body), &body); err != nil {
		t.Fatalf("decode send body %q: %v", send.body, err)
	}
	if body.ReceiveID != "ou_xxx" || body.MsgType != "interactive" {
		t.Errorf("body = %+v, want the open_id receive_id and interactive msg_type", body)
	}
	if !strings.Contains(body.Content, "Claude Pro") {
		t.Errorf("content = %q, want the rendered card", body.Content)
	}
}

func TestSendFeishuAppMessageRetriesOn401(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-old"),
		{status: http.StatusUnauthorized, body: `{"code":99991663,"msg":"invalid token"}`},
		tokenOK("t-new"),
		sendOK(),
	}}
	client := feishuClientFor(transport, &nowMs)

	if err := client.Send(context.Background(), lowBalanceEventFixture(), feishuCredsFixture()); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if transport.callCount() != 4 {
		t.Fatalf("calls = %d, want 4 (token, send, refresh, retry)", transport.callCount())
	}
	if got := transport.request(t, 3).header.Get("Authorization"); got != "Bearer t-new" {
		t.Errorf("retry Authorization = %q, want the refreshed token", got)
	}
}

func TestSendFeishuAppMessageRetriesOnTokenExpiredCode(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-old"),
		{body: `{"code":99991663,"msg":"token expired"}`},
		tokenOK("t-new"),
		sendOK(),
	}}
	client := feishuClientFor(transport, &nowMs)

	if err := client.Send(context.Background(), lowBalanceEventFixture(), feishuCredsFixture()); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if transport.callCount() != 4 {
		t.Errorf("calls = %d, want 4", transport.callCount())
	}
}

func TestSendFeishuAppMessageFailsAfterRetry(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-old"),
		{status: http.StatusUnauthorized, body: ""},
		tokenOK("t-new"),
		{status: http.StatusUnauthorized, body: ""},
	}}
	client := feishuClientFor(transport, &nowMs)

	err := client.Send(context.Background(), lowBalanceEventFixture(), feishuCredsFixture())
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("err = %v, want it to carry HTTP 401", err)
	}
	if transport.callCount() != 4 {
		t.Errorf("calls = %d, want 4 (retry not repeated)", transport.callCount())
	}
}

func TestSendFeishuAppMessageUsesChatIDReceiveType(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token"), sendOK()}}
	client := feishuClientFor(transport, &nowMs)

	creds := feishuCredsFixture()
	creds.ReceiveID = "oc_yyy"
	creds.ReceiveIDType = "chat_id"
	if err := client.Send(context.Background(), lowBalanceEventFixture(), creds); err != nil {
		t.Fatalf("Send: %v", err)
	}

	send := transport.request(t, 1)
	if !strings.Contains(send.url, "receive_id_type=chat_id") {
		t.Errorf("url = %q, want receive_id_type=chat_id", send.url)
	}
	if !strings.Contains(send.body, `"oc_yyy"`) {
		t.Errorf("body = %q, want the chat_id receive_id", send.body)
	}
}

// ---------- channel routing (1 case) ----------

func TestFeishuAppSenderRoutesChannelToAppBot(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{tokenOK("t-token"), sendOK()}}
	client := feishuClientFor(transport, &nowMs)

	channel := model.NotificationChannel{
		ID:            "ch-feishu-app",
		Type:          TypeFeishuApp,
		Name:          "Feishu App",
		AppID:         "app-id",
		AppSecret:     "app-secret",
		ReceiveID:     "ou_xxx",
		ReceiveIDType: "open_id",
		Enabled:       true,
	}
	if err := client.SendToChannel(context.Background(), lowBalanceEventFixture(), channel); err != nil {
		t.Fatalf("SendToChannel: %v", err)
	}
	if transport.callCount() != 2 {
		t.Errorf("calls = %d, want token + send via the app bot sender", transport.callCount())
	}
}

// ---------- credentials helper (3 cases) ----------

func TestFeishuAppCredentialsExtractsFields(t *testing.T) {
	creds, err := FeishuAppCredentialsFor(model.NotificationChannel{
		ID:            "ch-1",
		Type:          TypeFeishuApp,
		Name:          "Test",
		AppID:         "app-id",
		AppSecret:     "app-secret",
		ReceiveID:     "ou_xxx",
		ReceiveIDType: "open_id",
		Enabled:       true,
	})
	if err != nil {
		t.Fatalf("FeishuAppCredentialsFor: %v", err)
	}
	want := FeishuAppCredentials{
		AppID:         "app-id",
		AppSecret:     "app-secret",
		ReceiveID:     "ou_xxx",
		ReceiveIDType: "open_id",
	}
	if creds != want {
		t.Errorf("creds = %+v, want %+v", creds, want)
	}
}

func TestFeishuAppCredentialsRejectsOtherType(t *testing.T) {
	_, err := FeishuAppCredentialsFor(model.NotificationChannel{
		ID: "ch-1", Type: TypeWebhook, Name: "Test", URL: "https://example.com", Enabled: true,
	})
	if err == nil || !strings.Contains(err.Error(), "not a feishu-app channel") {
		t.Fatalf("err = %v, want the wrong-type message", err)
	}
}

func TestFeishuAppCredentialsRejectsMissingFields(t *testing.T) {
	_, err := FeishuAppCredentialsFor(model.NotificationChannel{
		ID: "ch-1", Type: TypeFeishuApp, Name: "Test", AppID: "app-id", Enabled: true,
	})
	if err == nil || !strings.Contains(err.Error(), "missing required fields") {
		t.Fatalf("err = %v, want the missing-fields message", err)
	}
}
