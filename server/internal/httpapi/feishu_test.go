package httpapi

// Route parity for the Feishu app-bot surface (app/api/notifications/feishu-app/**
// and the feishu-app branch of the channel test send). The old stack had no
// route tests here either, so these lock the contract the settings page
// consumes: response shapes, status codes, the credential resolution order and
// the exact failure payload when Feishu rejects a call.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/notify"
	"ai-subscriptions/internal/store"
)

// feishuStub replays scripted Feishu platform responses and records the
// requests the server really put on the wire.
type feishuStub struct {
	mu        sync.Mutex
	requests  []string
	bodies    []string
	responses []string
	calls     int
}

func (s *feishuStub) Do(req *http.Request) (*http.Response, error) {
	var body string
	if req.Body != nil {
		raw, _ := io.ReadAll(req.Body)
		body = string(raw)
	}

	s.mu.Lock()
	s.requests = append(s.requests, req.Method+" "+req.URL.String())
	s.bodies = append(s.bodies, body)
	index := s.calls
	s.calls++
	payload := `{"code":0}`
	if index < len(s.responses) {
		payload = s.responses[index]
	}
	s.mu.Unlock()

	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(payload)),
	}, nil
}

func (s *feishuStub) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func (s *feishuStub) requestAt(t *testing.T, index int) string {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if index >= len(s.requests) {
		t.Fatalf("request %d not made, %d recorded", index, len(s.requests))
	}
	return s.requests[index]
}

func (s *feishuStub) bodyAt(t *testing.T, index int) string {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if index >= len(s.bodies) {
		t.Fatalf("request %d not made, %d recorded", index, len(s.bodies))
	}
	return s.bodies[index]
}

type feishuFixture struct {
	handler   http.Handler
	store     *store.Store
	cookie    *http.Cookie
	stub      *feishuStub
	listeners *notify.ListenerManager
	scheduler *listenerScheduler
}

func newFeishuFixture(t *testing.T) feishuFixture {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	svc := auth.New(db, "feishu-route-secret")
	result, err := svc.Authenticate(auth.SeedUsername, auth.SeedPassword, "203.0.113.51")
	if err != nil {
		t.Fatalf("seed login: %v", err)
	}

	stub := &feishuStub{}
	scheduler := &listenerScheduler{}
	listeners := notify.NewListenerManager(notify.ListenerOptions{
		Scheduler: scheduler,
		Now:       func() time.Time { return time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC) },
		NewID:     func() string { return "listen-id-1" },
		SocketFactory: func(appID, appSecret string, onMessage func(notify.ReceivedMessage)) (notify.FeishuSocket, error) {
			return &stubSocket{onMessage: onMessage}, nil
		},
	})
	t.Cleanup(listeners.Reset)

	return feishuFixture{
		handler: New(Options{
			Auth:      svc,
			Notify:    db,
			Feishu:    notify.NewFeishuClient(stub, func() time.Time { return time.UnixMilli(1000000) }),
			Listeners: listeners,
		}),
		store:     db,
		cookie:    &http.Cookie{Name: authCookieName, Value: result.Token},
		stub:      stub,
		listeners: listeners,
		scheduler: scheduler,
	}
}

// listenerScheduler fires timers immediately on Advance.
type listenerScheduler struct {
	mu      sync.Mutex
	pending []*listenerTimer
}

type listenerTimer struct {
	after   time.Duration
	fn      func()
	fired   bool
	stopped bool
}

func (s *listenerScheduler) AfterFunc(d time.Duration, fn func()) notify.Timer {
	s.mu.Lock()
	defer s.mu.Unlock()
	timer := &listenerTimer{after: d, fn: fn}
	s.pending = append(s.pending, timer)
	return timer
}

func (s *listenerScheduler) Advance(d time.Duration) {
	s.mu.Lock()
	toFire := make([]*listenerTimer, 0, len(s.pending))
	for _, timer := range s.pending {
		if timer.fired || timer.stopped || timer.after > d {
			continue
		}
		timer.fired = true
		toFire = append(toFire, timer)
	}
	s.mu.Unlock()
	for _, timer := range toFire {
		timer.fn()
	}
}

func (t *listenerTimer) Stop() bool {
	return true
}

type stubSocket struct {
	onMessage func(notify.ReceivedMessage)
	closed    bool
}

func (s *stubSocket) Connect(ctx context.Context) error { return nil }
func (s *stubSocket) Close() error {
	s.closed = true
	return nil
}

func (f feishuFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(f.cookie)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func decodeFeishu(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

// createFeishuChannel stores a feishu-app channel and returns its id.
func (f feishuFixture) createFeishuChannel(t *testing.T) string {
	t.Helper()
	rec := f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Bot","type":"feishu-app","appId":"cli_stored","appSecret":"stored-secret","receiveId":"oc_1","receiveIdType":"chat_id"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create channel status = %d (body %s)", rec.Code, rec.Body.String())
	}
	return decodeFeishu(t, rec)["id"].(string)
}

// ---------- chats ----------

func TestFeishuChatsListsWithDirectCredentials(t *testing.T) {
	f := newFeishuFixture(t)
	f.stub.responses = []string{
		`{"code":0,"tenant_access_token":"t-token","expire":7200}`,
		`{"code":0,"data":{"items":[{"chat_id":"oc_abc","name":"Test Group"}],"has_more":false}}`,
	}

	rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/chats",
		`{"appId":"cli_1","appSecret":"sec_1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}

	body := decodeFeishu(t, rec)
	items, _ := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items = %v, want one chat", body["items"])
	}
	chat, _ := items[0].(map[string]any)
	if chat["chat_id"] != "oc_abc" || chat["name"] != "Test Group" {
		t.Errorf("chat = %v, want the Feishu chat shape", chat)
	}
	if body["has_more"] != false {
		t.Errorf("has_more = %v, want false", body["has_more"])
	}
}

func TestFeishuChatsUsesStoredChannelSecret(t *testing.T) {
	f := newFeishuFixture(t)
	id := f.createFeishuChannel(t)
	f.stub.responses = []string{
		`{"code":0,"tenant_access_token":"t-token","expire":7200}`,
		`{"code":0,"data":{"items":[],"has_more":false}}`,
	}

	rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/chats",
		`{"channelId":"`+id+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if got := f.stub.bodyAt(t, 0); !strings.Contains(got, "stored-secret") {
		t.Errorf("token body = %q, want the stored secret", got)
	}
}

func TestFeishuChatsReportsCredentialErrors(t *testing.T) {
	f := newFeishuFixture(t)

	rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/chats", `{"channelId":"nope"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %s)", rec.Code, rec.Body.String())
	}
	if message, _ := decodeFeishu(t, rec)["error"].(string); !strings.Contains(message, "不存在") {
		t.Errorf("error = %q, want the channel-not-found message", message)
	}
}

func TestFeishuChatsSurfacesFeishuError(t *testing.T) {
	f := newFeishuFixture(t)
	f.stub.responses = []string{
		`{"code":0,"tenant_access_token":"t-token","expire":7200}`,
		`{"code":99991400,"msg":"permission denied"}`,
	}

	rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/chats",
		`{"appId":"cli_1","appSecret":"sec_1"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %s)", rec.Code, rec.Body.String())
	}
	if message, _ := decodeFeishu(t, rec)["error"].(string); !strings.Contains(message, "权限不足") {
		t.Errorf("error = %q, want the translated permission message", message)
	}
}

// ---------- lookup-user ----------

func TestFeishuLookupUserResolvesPhone(t *testing.T) {
	f := newFeishuFixture(t)
	f.stub.responses = []string{
		`{"code":0,"tenant_access_token":"t-token","expire":7200}`,
		`{"code":0,"data":{"user_list":[{"user_id":{"open_id":"ou_abc"},"mobile":"+8613800138000"}]}}`,
	}

	rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/lookup-user",
		`{"appId":"cli_1","appSecret":"sec_1","mobiles":["  +8613800138000  "]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	users, _ := decodeFeishu(t, rec)["user_list"].([]any)
	if len(users) != 1 {
		t.Fatalf("user_list = %v, want one user", users)
	}
	if got := f.stub.bodyAt(t, 1); !strings.Contains(got, `"+8613800138000"`) {
		t.Errorf("lookup body = %q, want the trimmed phone number", got)
	}
}

func TestFeishuLookupUserRejectsInvalidMobiles(t *testing.T) {
	f := newFeishuFixture(t)

	cases := []struct {
		name string
		body string
		want string
	}{
		{"missing mobiles", `{"appId":"cli_1","appSecret":"sec_1"}`, "mobiles 必须是包含至少一个手机号的数组"},
		{"empty array", `{"appId":"cli_1","appSecret":"sec_1","mobiles":[]}`, "mobiles 必须是包含至少一个手机号的数组"},
		{"empty element", `{"appId":"cli_1","appSecret":"sec_1","mobiles":["  "]}`, "mobiles 数组中的每个元素必须是非空字符串"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/lookup-user", testCase.body)
			assertNotifyError(t, rec, http.StatusBadRequest, testCase.want)
		})
	}
}

// ---------- listen ----------

func TestFeishuListenStartStatusPollStop(t *testing.T) {
	f := newFeishuFixture(t)

	started := f.do(t, http.MethodPost, "/api/notifications/feishu-app/listen",
		`{"appId":"cli_1","appSecret":"sec_1"}`)
	if started.Code != http.StatusOK {
		t.Fatalf("start status = %d, want 200 (body %s)", started.Code, started.Body.String())
	}
	status := decodeFeishu(t, started)
	if status["listenId"] != "listen-id-1" {
		t.Errorf("listenId = %v, want listen-id-1", status["listenId"])
	}
	if status["ttlSeconds"] != float64(notify.DefaultListenerTTLSeconds) {
		t.Errorf("ttlSeconds = %v, want the default", status["ttlSeconds"])
	}
	if status["stopped"] != false {
		t.Errorf("stopped = %v, want false", status["stopped"])
	}

	polled := f.do(t, http.MethodGet, "/api/notifications/feishu-app/listen?listenId=listen-id-1", "")
	if polled.Code != http.StatusOK {
		t.Fatalf("poll status = %d, want 200 (body %s)", polled.Code, polled.Body.String())
	}
	payload := decodeFeishu(t, polled)
	pollStatus, _ := payload["status"].(map[string]any)
	if pollStatus["appId"] != "cli_1" {
		t.Errorf("status.appId = %v, want cli_1", pollStatus["appId"])
	}
	if messages, ok := payload["messages"].([]any); !ok || len(messages) != 0 {
		t.Errorf("messages = %v, want an empty array", payload["messages"])
	}

	stopped := f.do(t, http.MethodDelete, "/api/notifications/feishu-app/listen?listenId=listen-id-1", "")
	if stopped.Code != http.StatusOK {
		t.Fatalf("stop status = %d, want 200 (body %s)", stopped.Code, stopped.Body.String())
	}
	if decodeFeishu(t, stopped)["success"] != true {
		t.Error("success = false, want true")
	}
}

func TestFeishuListenHonoursCustomTTL(t *testing.T) {
	f := newFeishuFixture(t)

	started := f.do(t, http.MethodPost, "/api/notifications/feishu-app/listen",
		`{"appId":"cli_1","appSecret":"sec_1","ttl_seconds":60}`)
	if started.Code != http.StatusOK {
		t.Fatalf("start status = %d, want 200 (body %s)", started.Code, started.Body.String())
	}
	if got := decodeFeishu(t, started)["ttlSeconds"]; got != float64(60) {
		t.Errorf("ttlSeconds = %v, want 60", got)
	}
}

func TestFeishuListenPollRequiresID(t *testing.T) {
	f := newFeishuFixture(t)

	assertNotifyError(t, f.do(t, http.MethodGet, "/api/notifications/feishu-app/listen", ""),
		http.StatusBadRequest, "缺少 listenId 或 appId 参数")
	assertNotifyError(t, f.do(t, http.MethodDelete, "/api/notifications/feishu-app/listen", ""),
		http.StatusBadRequest, "缺少 listenId 或 appId 参数")
}

func TestFeishuListenPollUnknownReturns404(t *testing.T) {
	f := newFeishuFixture(t)

	rec := f.do(t, http.MethodGet, "/api/notifications/feishu-app/listen?listenId=gone", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body %s)", rec.Code, rec.Body.String())
	}
	if message, _ := decodeFeishu(t, rec)["error"].(string); !strings.Contains(message, "没有找到监听器") {
		t.Errorf("error = %q, want the listener-not-found message", message)
	}
}

func TestFeishuListenStopUnknownReportsFalse(t *testing.T) {
	f := newFeishuFixture(t)

	rec := f.do(t, http.MethodDelete, "/api/notifications/feishu-app/listen?appId=gone", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if decodeFeishu(t, rec)["success"] != false {
		t.Error("success = true, want false for an unknown listener")
	}
}

func TestFeishuListenStartReportsCredentialErrors(t *testing.T) {
	f := newFeishuFixture(t)

	rec := f.do(t, http.MethodPost, "/api/notifications/feishu-app/listen", `{}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %s)", rec.Code, rec.Body.String())
	}
	if message, _ := decodeFeishu(t, rec)["error"].(string); !strings.Contains(message, "请提供 appId 和 appSecret") {
		t.Errorf("error = %q, want the credential hint", message)
	}
}

// ---------- channel test send ----------

func TestNotificationsTestSendFeishuAppUsesAppBot(t *testing.T) {
	f := newFeishuFixture(t)
	id := f.createFeishuChannel(t)
	f.stub.responses = []string{
		`{"code":0,"tenant_access_token":"t-token","expire":7200}`,
		`{"code":0,"msg":"success"}`,
	}

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeFeishu(t, rec)
	if body["success"] != true {
		t.Errorf("success = %v, want true", body["success"])
	}

	send := f.stub.requestAt(t, 1)
	if !strings.Contains(send, "/open-apis/im/v1/messages?receive_id_type=chat_id") {
		t.Errorf("send request = %q, want the messages endpoint with chat_id", send)
	}
	if payload := f.stub.bodyAt(t, 1); !strings.Contains(payload, "测试订阅") {
		t.Errorf("send body = %q, want the rendered test card", payload)
	}

	stored, err := f.store.NotificationChannelByID(id)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if stored.LastSendResult == nil || !stored.LastSendResult.Success {
		t.Errorf("lastSendResult = %+v, want a recorded success", stored.LastSendResult)
	}
}

func TestNotificationsTestSendFeishuAppFailureReturns502(t *testing.T) {
	f := newFeishuFixture(t)
	id := f.createFeishuChannel(t)
	f.stub.responses = []string{
		`{"code":0,"tenant_access_token":"t-token","expire":7200}`,
		`{"code":99991672,"msg":"missing scope: im:message:send_as_bot"}`,
	}

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeFeishu(t, rec)
	if body["success"] != false {
		t.Errorf("success = %v, want false", body["success"])
	}
	message, _ := body["error"].(string)
	if !strings.Contains(message, "im:message:send_as_bot") {
		t.Errorf("error = %q, want the missing scope named", message)
	}

	stored, err := f.store.NotificationChannelByID(id)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if stored.LastSendResult == nil || stored.LastSendResult.Success || stored.LastSendResult.Error == "" {
		t.Errorf("lastSendResult = %+v, want a recorded failure", stored.LastSendResult)
	}
}
