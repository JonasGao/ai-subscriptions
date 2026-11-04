package httpapi

// Route parity for the notification surface (app/api/notifications/**). The
// old stack had no route-level tests for these handlers, so the cases here
// lock the contract the SPA consumes: response shapes, the exact status codes
// and error messages, the secret-redaction rules, and — the acceptance
// criterion of #37 — a signed test send that really reaches the wire.

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/store"
)

type notifyFixture struct {
	handler http.Handler
	store   *store.Store
	cookie  *http.Cookie
}

func newNotifyFixture(t *testing.T) notifyFixture {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	svc := auth.New(db, "notify-route-secret")
	result, err := svc.Authenticate(auth.SeedUsername, auth.SeedPassword, "203.0.113.50")
	if err != nil {
		t.Fatalf("seed login: %v", err)
	}

	return notifyFixture{
		handler: New(Options{Auth: svc, Notify: db}),
		store:   db,
		cookie:  &http.Cookie{Name: authCookieName, Value: result.Token},
	}
}

func (f notifyFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(f.cookie)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func decodeNotify(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

func assertNotifyError(t *testing.T, rec *httptest.ResponseRecorder, status int, message string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, status, rec.Body.String())
	}
	if got := decodeNotify(t, rec)["error"]; got != message {
		t.Fatalf("error = %v, want %q", got, message)
	}
}

func TestNotificationsListReturnsSanitizedChannelsAndThreshold(t *testing.T) {
	f := newNotifyFixture(t)

	created := f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Ops","type":"dingtalk","url":"https://example.com/hook","secret":"shh"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201 (body %s)", created.Code, created.Body.String())
	}

	rec := f.do(t, http.MethodGet, "/api/notifications", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := decodeNotify(t, rec)

	if body["defaultLowBalanceThreshold"] != float64(10) {
		t.Errorf("defaultLowBalanceThreshold = %v, want 10", body["defaultLowBalanceThreshold"])
	}
	channels, ok := body["channels"].([]any)
	if !ok || len(channels) != 1 {
		t.Fatalf("channels = %v, want one entry", body["channels"])
	}
	channel := channels[0].(map[string]any)
	if channel["hasSecret"] != true {
		t.Errorf("hasSecret = %v, want true", channel["hasSecret"])
	}
	if _, present := channel["secret"]; present {
		t.Error("response leaks the signing secret to the client")
	}
	if channel["name"] != "Ops" || channel["type"] != "dingtalk" || channel["enabled"] != true {
		t.Errorf("channel = %v, want name/type/enabled echoed", channel)
	}
}

func TestNotificationsCreateWebhookChannelReturns201(t *testing.T) {
	f := newNotifyFixture(t)

	rec := f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Hook","type":"webhook","url":"https://example.com/h"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeNotify(t, rec)
	if body["enabled"] != true {
		t.Errorf("enabled = %v, want true by default", body["enabled"])
	}
	if body["hasSecret"] != false {
		t.Errorf("hasSecret = %v, want false", body["hasSecret"])
	}
	if id, _ := body["id"].(string); len(id) != 36 {
		t.Errorf("id = %v, want a UUID", body["id"])
	}
	if body["createdAt"] != body["updatedAt"] {
		t.Errorf("createdAt %v != updatedAt %v", body["createdAt"], body["updatedAt"])
	}
}

func TestNotificationsCreateValidationErrors(t *testing.T) {
	invalidType := "Invalid type. Must be one of: dingtalk, feishu, webhook, feishu-app"

	cases := []struct {
		name    string
		body    string
		message string
	}{
		{"missing name", `{"type":"webhook","url":"https://example.com/h"}`, "Channel name is required"},
		{"blank name", `{"name":"   ","type":"webhook","url":"https://example.com/h"}`, "Channel name is required"},
		{"invalid type", `{"name":"X","type":"sms","url":"https://example.com/h"}`, invalidType},
		{"missing url", `{"name":"X","type":"webhook"}`, "A valid http(s) webhook URL is required"},
		{"non-http url", `{"name":"X","type":"webhook","url":"ftp://example.com/h"}`, "A valid http(s) webhook URL is required"},
		{"secret not a string", `{"name":"X","type":"feishu","url":"https://example.com/h","secret":5}`, "secret must be a string"},
		{"malformed json", `{"name":`, "Invalid JSON in request body"},
		{"array body", `[]`, "Request body must be a JSON object"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newNotifyFixture(t)
			rec := f.do(t, http.MethodPost, "/api/notifications", tc.body)
			assertNotifyError(t, rec, http.StatusBadRequest, tc.message)
		})
	}
}

func TestNotificationsCreateFeishuAppValidationErrors(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		message string
	}{
		{"missing appId", `{"name":"X","type":"feishu-app","appSecret":"s","receiveId":"r","receiveIdType":"open_id"}`, "appId is required for feishu-app channel"},
		{"missing appSecret", `{"name":"X","type":"feishu-app","appId":"a","receiveId":"r","receiveIdType":"open_id"}`, "appSecret is required for feishu-app channel"},
		{"missing receiveId", `{"name":"X","type":"feishu-app","appId":"a","appSecret":"s","receiveIdType":"open_id"}`, "receiveId is required for feishu-app channel"},
		{"bad receiveIdType", `{"name":"X","type":"feishu-app","appId":"a","appSecret":"s","receiveId":"r","receiveIdType":"user_id"}`, "receiveIdType must be 'open_id' or 'chat_id'"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newNotifyFixture(t)
			rec := f.do(t, http.MethodPost, "/api/notifications", tc.body)
			assertNotifyError(t, rec, http.StatusBadRequest, tc.message)
		})
	}
}

func TestNotificationsCreateFeishuAppChannelHidesAppSecret(t *testing.T) {
	f := newNotifyFixture(t)

	rec := f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Bot","type":"feishu-app","appId":"cli_x","appSecret":"very-secret","receiveId":"oc_1","receiveIdType":"chat_id"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeNotify(t, rec)
	if body["hasAppSecret"] != true || body["hasSecret"] != false {
		t.Errorf("hasAppSecret/hasSecret = %v/%v, want true/false", body["hasAppSecret"], body["hasSecret"])
	}
	if _, present := body["appSecret"]; present {
		t.Error("response leaks appSecret to the client")
	}
	if body["appId"] != "cli_x" || body["receiveIdType"] != "chat_id" {
		t.Errorf("body = %v, want appId/receiveIdType echoed", body)
	}
}

func TestNotificationsUpdateChannelMergesAndClearsSecret(t *testing.T) {
	f := newNotifyFixture(t)

	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"A","type":"dingtalk","url":"https://example.com/a","secret":"s"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPut, "/api/notifications/"+id, `{"name":"B","secret":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeNotify(t, rec)
	if body["name"] != "B" {
		t.Errorf("name = %v, want B", body["name"])
	}
	if body["hasSecret"] != false {
		t.Errorf("hasSecret = %v, want false after clearing", body["hasSecret"])
	}
	if body["type"] != "dingtalk" || body["url"] != "https://example.com/a" {
		t.Errorf("untouched fields lost: %v", body)
	}
}

func TestNotificationsUpdateChannelRejectsEmptyFields(t *testing.T) {
	f := newNotifyFixture(t)
	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"A","type":"webhook","url":"https://example.com/a"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPut, "/api/notifications/"+id, `{"name":"  "}`)
	assertNotifyError(t, rec, http.StatusBadRequest, "Channel name cannot be empty")

	rec = f.do(t, http.MethodPut, "/api/notifications/"+id, `{"url":"not-a-url"}`)
	assertNotifyError(t, rec, http.StatusBadRequest, "A valid http(s) webhook URL is required")
}

func TestNotificationsUpdateFeishuAppChannelAppSecretGuard(t *testing.T) {
	f := newNotifyFixture(t)
	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Bot","type":"feishu-app","appId":"cli_x","appSecret":"very-secret","receiveId":"oc_1","receiveIdType":"chat_id"}`))
	id := created["id"].(string)

	// Ported verbatim from the old PUT handler: the guard falls back to the
	// stored appSecret even when the patch clears it, so the first clear is
	// accepted (the old stack did the same — a quirk kept for parity).
	rec := f.do(t, http.MethodPut, "/api/notifications/"+id, `{"appSecret":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear secret status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if body := decodeNotify(t, rec); body["hasAppSecret"] != false {
		t.Errorf("hasAppSecret = %v, want false after clearing", body["hasAppSecret"])
	}

	// With no stored value left, the guard is reachable and rejects.
	rec = f.do(t, http.MethodPut, "/api/notifications/"+id, `{"appSecret":""}`)
	assertNotifyError(t, rec, http.StatusBadRequest, "feishu-app channel requires a non-empty appSecret")

	// Replacing the secret still works, and it stays redacted on the wire.
	rec = f.do(t, http.MethodPut, "/api/notifications/"+id, `{"appSecret":"new-secret"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("replace status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if body := decodeNotify(t, rec); body["hasAppSecret"] != true {
		t.Errorf("hasAppSecret = %v, want true", body["hasAppSecret"])
	}
	stored, err := f.store.NotificationChannelByID(id)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if stored.AppSecret != "new-secret" {
		t.Errorf("appSecret = %q, want the replacement stored", stored.AppSecret)
	}
}

func TestNotificationsUpdateUnknownChannelReturns404(t *testing.T) {
	f := newNotifyFixture(t)

	rec := f.do(t, http.MethodPut, "/api/notifications/nope", `{"name":"B"}`)
	assertNotifyError(t, rec, http.StatusNotFound, "Channel not found")
}

func TestNotificationsDeleteChannel(t *testing.T) {
	f := newNotifyFixture(t)
	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Hook","type":"webhook","url":"https://example.com/h"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodDelete, "/api/notifications/"+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := decodeNotify(t, rec); body["success"] != true {
		t.Errorf("success = %v, want true", body["success"])
	}

	rec = f.do(t, http.MethodDelete, "/api/notifications/"+id, "")
	assertNotifyError(t, rec, http.StatusNotFound, "Channel not found")
}

func TestNotificationsToggleChannel(t *testing.T) {
	f := newNotifyFixture(t)
	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"F","type":"feishu","url":"https://example.com/f"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"toggle"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if body := decodeNotify(t, rec); body["enabled"] != false {
		t.Errorf("enabled = %v, want false", body["enabled"])
	}
}

func TestNotificationsUnknownActionRejected(t *testing.T) {
	f := newNotifyFixture(t)
	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"F","type":"feishu","url":"https://example.com/f"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"explode"}`)
	assertNotifyError(t, rec, http.StatusBadRequest, `Unknown action. Use "test" or "toggle".`)
}

// receivedRequest is what the fake webhook endpoint recorded.
type receivedRequest struct {
	method   string
	query    url.Values
	rawQuery string
	body     map[string]any
	raw      string
}

// webhookRecorder is a stand-in for the customer's webhook endpoint. It
// records the request the notification sender actually put on the wire.
type webhookRecorder struct {
	*httptest.Server
	mu       sync.Mutex
	requests []receivedRequest
	status   int
}

func newWebhookRecorder(t *testing.T) *webhookRecorder {
	t.Helper()
	rec := &webhookRecorder{status: http.StatusOK}
	rec.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var raw bytes.Buffer
		_, _ = raw.ReadFrom(r.Body)
		var decoded map[string]any
		_ = json.Unmarshal(raw.Bytes(), &decoded)

		rec.mu.Lock()
		rec.requests = append(rec.requests, receivedRequest{
			method:   r.Method,
			query:    r.URL.Query(),
			rawQuery: r.URL.RawQuery,
			body:     decoded,
			raw:      raw.String(),
		})
		status := rec.status
		rec.mu.Unlock()

		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(rec.Close)
	return rec
}

func (r *webhookRecorder) last(t *testing.T) receivedRequest {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.requests) == 0 {
		t.Fatal("webhook endpoint received no request")
	}
	return r.requests[len(r.requests)-1]
}

func (r *webhookRecorder) setStatus(status int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.status = status
}

// rawQueryParam returns the still-encoded value of key in a raw query string.
func rawQueryParam(rawQuery, key string) string {
	for _, pair := range strings.Split(rawQuery, "&") {
		name, value, found := strings.Cut(pair, "=")
		if found && name == key {
			return value
		}
	}
	return ""
}

// expectedDingtalkSign recomputes the DingTalk signature straight from the
// documented scheme (HMAC-SHA256 over "timestamp\nsecret", keyed by the
// secret, base64, then URL-encoded) so the assertion has an independent
// source of truth. The receiver's query parser hands back the decoded value.
func expectedDingtalkSign(t *testing.T, secret, timestamp string) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "\n" + secret))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func TestNotificationsTestSendDingtalkSignsURLAndRecordsResult(t *testing.T) {
	f := newNotifyFixture(t)
	hook := newWebhookRecorder(t)

	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Ops","type":"dingtalk","url":"`+hook.URL+`/robot/send?access_token=tok","secret":"ding-secret"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeNotify(t, rec)
	if body["success"] != true {
		t.Fatalf("success = %v, want true (body %s)", body["success"], rec.Body.String())
	}

	sent := hook.last(t)
	if sent.method != http.MethodPost {
		t.Errorf("method = %s, want POST", sent.method)
	}
	if sent.query.Get("access_token") != "tok" {
		t.Errorf("access_token = %q, want the original query preserved", sent.query.Get("access_token"))
	}
	timestamp := sent.query.Get("timestamp")
	if timestamp == "" {
		t.Fatal("signed URL is missing the timestamp parameter")
	}
	if got, want := sent.query.Get("sign"), expectedDingtalkSign(t, "ding-secret", timestamp); got != want {
		t.Errorf("sign = %q, want %q", got, want)
	}
	// The sign goes into a query value, so base64's '+' '/' '=' must be
	// percent-encoded on the wire (encodeURIComponent in the old stack).
	rawSign := rawQueryParam(sent.rawQuery, "sign")
	if rawSign != "" && strings.ContainsAny(rawSign, "+/=") {
		t.Errorf("raw sign %q is not percent-encoded", rawSign)
	}
	if sent.body["msgtype"] != "markdown" {
		t.Errorf("msgtype = %v, want markdown", sent.body["msgtype"])
	}
	markdown, _ := sent.body["markdown"].(map[string]any)
	if title, _ := markdown["title"].(string); !strings.Contains(title, "余额不足") {
		t.Errorf("title = %q, want it to mention 余额不足", title)
	}
	if text, _ := markdown["text"].(string); !strings.Contains(text, "测试订阅") {
		t.Errorf("text = %q, want the placeholder subscription name", text)
	}

	// Result is recorded on the channel: success, timestamp, no error.
	stored, err := f.store.NotificationChannelByID(id)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if stored.LastSendResult == nil || !stored.LastSendResult.Success {
		t.Fatalf("lastSendResult = %+v, want success", stored.LastSendResult)
	}
	if stored.LastSendResult.Error != "" {
		t.Errorf("lastSendResult.Error = %q, want empty", stored.LastSendResult.Error)
	}
}

func TestNotificationsTestSendFeishuSignsBody(t *testing.T) {
	f := newNotifyFixture(t)
	hook := newWebhookRecorder(t)

	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Alerts","type":"feishu","url":"`+hook.URL+`/open-apis/bot/v2/hook/x","secret":"feishu-secret"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}

	sent := hook.last(t)
	if sent.body["msg_type"] != "interactive" {
		t.Errorf("msg_type = %v, want interactive", sent.body["msg_type"])
	}
	timestamp, _ := sent.body["timestamp"].(string)
	sign, _ := sent.body["sign"].(string)
	if timestamp == "" || sign == "" {
		t.Fatalf("body = %v, want timestamp and sign (Feishu signs the body, not the URL)", sent.body)
	}
	mac := hmac.New(sha256.New, []byte(timestamp+"\nfeishu-secret"))
	mac.Write([]byte(""))
	if want := base64.StdEncoding.EncodeToString(mac.Sum(nil)); sign != want {
		t.Errorf("sign = %q, want %q", sign, want)
	}
	card, _ := sent.body["card"].(map[string]any)
	header, _ := card["header"].(map[string]any)
	title, _ := header["title"].(map[string]any)
	if content, _ := title["content"].(string); strings.Contains(content, "【AI订阅】") {
		t.Errorf("title = %q; a signed channel must not carry the keyword prefix", content)
	}
}

func TestNotificationsTestSendWebhookPostsGenericPayload(t *testing.T) {
	f := newNotifyFixture(t)
	hook := newWebhookRecorder(t)

	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Hook","type":"webhook","url":"`+hook.URL+`/notify"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}

	sent := hook.last(t)
	if sent.body["event"] != "low-balance" {
		t.Errorf("event = %v, want low-balance", sent.body["event"])
	}
	if sent.body["balance"] != float64(1) || sent.body["threshold"] != float64(10) {
		t.Errorf("balance/threshold = %v/%v, want 1/10", sent.body["balance"], sent.body["threshold"])
	}
	sub, _ := sent.body["subscription"].(map[string]any)
	if sub["name"] != "测试订阅" || sub["id"] != "test" || sub["subscriptionType"] != "one-time" {
		t.Errorf("subscription = %v, want the synthetic test subscription", sub)
	}
	if _, present := sent.body["sign"]; present {
		t.Error("generic webhook payload must not carry Feishu signing fields")
	}
}

func TestNotificationsTestSendFailureReturns502AndRecordsError(t *testing.T) {
	f := newNotifyFixture(t)
	hook := newWebhookRecorder(t)
	hook.setStatus(http.StatusInternalServerError)

	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Hook","type":"webhook","url":"`+hook.URL+`/notify"}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
	body := decodeNotify(t, rec)
	if body["success"] != false {
		t.Errorf("success = %v, want false", body["success"])
	}
	message, _ := body["error"].(string)
	if !strings.Contains(message, "500") {
		t.Errorf("error = %q, want it to carry the HTTP status", message)
	}
	if body["channel"] == nil {
		t.Error("channel = nil, want the refreshed channel so the UI can show the failure")
	}

	stored, err := f.store.NotificationChannelByID(id)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if stored.LastSendResult == nil || stored.LastSendResult.Success || stored.LastSendResult.Error == "" {
		t.Errorf("lastSendResult = %+v, want a recorded failure", stored.LastSendResult)
	}
}

func TestNotificationsTestSendRejectsDisabledChannel(t *testing.T) {
	f := newNotifyFixture(t)
	hook := newWebhookRecorder(t)

	created := decodeNotify(t, f.do(t, http.MethodPost, "/api/notifications",
		`{"name":"Hook","type":"webhook","url":"`+hook.URL+`/notify","enabled":false}`))
	id := created["id"].(string)

	rec := f.do(t, http.MethodPost, "/api/notifications/"+id, `{"action":"test"}`)
	assertNotifyError(t, rec, http.StatusBadRequest, "Cannot test a disabled channel")

	hook.mu.Lock()
	defer hook.mu.Unlock()
	if len(hook.requests) != 0 {
		t.Errorf("disabled channel sent %d requests, want 0", len(hook.requests))
	}
}

func TestNotificationsUpdateDefaultThreshold(t *testing.T) {
	f := newNotifyFixture(t)

	rec := f.do(t, http.MethodPut, "/api/notifications", `{"defaultLowBalanceThreshold":25}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	if body := decodeNotify(t, rec); body["defaultLowBalanceThreshold"] != float64(25) {
		t.Errorf("defaultLowBalanceThreshold = %v, want 25", body["defaultLowBalanceThreshold"])
	}

	list := decodeNotify(t, f.do(t, http.MethodGet, "/api/notifications", ""))
	if list["defaultLowBalanceThreshold"] != float64(25) {
		t.Errorf("persisted threshold = %v, want 25", list["defaultLowBalanceThreshold"])
	}

	rec = f.do(t, http.MethodPut, "/api/notifications", `{"defaultLowBalanceThreshold":-1}`)
	assertNotifyError(t, rec, http.StatusBadRequest, "defaultLowBalanceThreshold must be a non-negative number")
}
