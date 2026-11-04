package httpapi

// Route parity for the proxy-subscription surface. The old stack exposed five
// handlers (app/api/proxy-subscriptions/**, app/api/proxy-tags/**) with no
// route-level tests of their own except __tests__/proxy-tags-route.test.ts,
// which asserts the tag list is never served from a build-time snapshot. That
// single parity case is ported here as
// TestProxyTagsRouteReadsMutableTagsDynamically, because the Go router has no
// `dynamic = "force-dynamic"` knob — the guarantee is now structural, so the
// test asserts the observable behaviour instead of the framework flag.
//
// The remaining cases lock the CRUD contract, the old stack's exact status
// codes and Chinese error messages, and the wire shape the SPA consumes.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/store"
)

type proxyFixture struct {
	handler http.Handler
	store   *store.Store
	cookie  *http.Cookie
}

// newProxyFixture builds a router backed by a real temporary store and a
// signed-in session, so the proxy routes run end to end behind the gate.
func newProxyFixture(t *testing.T) proxyFixture {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	svc := auth.New(db, "proxy-route-secret")
	result, err := svc.Authenticate(auth.SeedUsername, auth.SeedPassword, "203.0.113.40")
	if err != nil {
		t.Fatalf("seed login: %v", err)
	}

	return proxyFixture{
		handler: New(Options{Auth: svc, Proxy: db}),
		store:   db,
		cookie:  &http.Cookie{Name: authCookieName, Value: result.Token},
	}
}

func (f proxyFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(f.cookie)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func decodeProxy(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

// TestProxySubscriptionRoutesCRUDRoundTrip locks the five old handlers.
func TestProxySubscriptionRoutesCRUDRoundTrip(t *testing.T) {
	f := newProxyFixture(t)

	created := f.do(t, http.MethodPost, "/api/proxy-subscriptions", `{
		"name": " Relay ",
		"monthlyPrice": 19.9,
		"expirationDate": "2026-09-30",
		"website": "https://relay.example.com/?a=1&b=2",
		"notes": "备用线路",
		"status": "unused",
		"tagNames": ["备用"]
	}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("POST status = %d, want 201 (body=%s)", created.Code, created.Body.String())
	}
	if ct := created.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	body := decodeProxy(t, created)
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("created body has no id: %s", created.Body.String())
	}
	if body["name"] != "Relay" {
		t.Errorf("name = %v, want trimmed Relay", body["name"])
	}
	if body["monthlyPrice"] != 19.9 {
		t.Errorf("monthlyPrice = %v, want 19.9", body["monthlyPrice"])
	}
	if body["status"] != "unused" {
		t.Errorf("status = %v, want unused", body["status"])
	}
	tagIDs, ok := body["tagIds"].([]any)
	if !ok || len(tagIDs) != 1 {
		t.Fatalf("tagIds = %v, want a 1-element array", body["tagIds"])
	}
	// The old stack does not escape HTML characters in JSON responses.
	if !bytes.Contains(created.Body.Bytes(), []byte("a=1&b=2")) {
		t.Errorf("body escaped HTML characters: %s", created.Body.String())
	}

	list := f.do(t, http.MethodGet, "/api/proxy-subscriptions", "")
	if list.Code != http.StatusOK {
		t.Fatalf("GET list status = %d, want 200", list.Code)
	}
	var listed []map[string]any
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed) != 1 || listed[0]["id"] != id {
		t.Fatalf("list = %s, want the created record", list.Body.String())
	}

	single := f.do(t, http.MethodGet, "/api/proxy-subscriptions/"+id, "")
	if single.Code != http.StatusOK {
		t.Fatalf("GET by id status = %d, want 200", single.Code)
	}
	if got := decodeProxy(t, single)["expirationDate"]; got != "2026-09-30" {
		t.Errorf("expirationDate = %v, want 2026-09-30", got)
	}

	updated := f.do(t, http.MethodPut, "/api/proxy-subscriptions/"+id, `{
		"status": "in-use",
		"tagNames": ["工作"]
	}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200 (body=%s)", updated.Code, updated.Body.String())
	}
	updatedBody := decodeProxy(t, updated)
	if updatedBody["status"] != "in-use" {
		t.Errorf("status = %v, want in-use", updatedBody["status"])
	}
	if updatedBody["name"] != "Relay" {
		t.Errorf("name = %v, want the unchanged Relay", updatedBody["name"])
	}
	if len(updatedBody["tagIds"].([]any)) != 1 {
		t.Errorf("tagIds = %v, want 1 id after the tag swap", updatedBody["tagIds"])
	}

	tags := f.do(t, http.MethodGet, "/api/proxy-tags", "")
	var tagList []map[string]any
	if err := json.Unmarshal(tags.Body.Bytes(), &tagList); err != nil {
		t.Fatalf("decode tags: %v", err)
	}
	if len(tagList) != 2 {
		t.Fatalf("tags = %s, want 备用 and 工作", tags.Body.String())
	}

	deleted := f.do(t, http.MethodDelete, "/api/proxy-subscriptions/"+id, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("DELETE status = %d, want 200", deleted.Code)
	}
	if got := decodeProxy(t, deleted)["success"]; got != true {
		t.Errorf("DELETE body = %s, want {\"success\":true}", deleted.Body.String())
	}

	missing := f.do(t, http.MethodGet, "/api/proxy-subscriptions/"+id, "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("GET after delete status = %d, want 404", missing.Code)
	}
	if got := decodeProxy(t, missing)["error"]; got != "Proxy subscription not found" {
		t.Errorf("error = %v, want Proxy subscription not found", got)
	}
}

// TestProxySubscriptionRoutesClearExpirationDate locks the unlimited-traffic
// path: an explicit empty expirationDate clears it, and the field is dropped
// from the response exactly like the old stack's `undefined`.
func TestProxySubscriptionRoutesClearExpirationDate(t *testing.T) {
	f := newProxyFixture(t)

	created := f.do(t, http.MethodPost, "/api/proxy-subscriptions",
		`{"name":"Traffic","monthlyPrice":10,"status":"in-use"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("POST status = %d (body=%s)", created.Code, created.Body.String())
	}
	body := decodeProxy(t, created)
	if _, present := body["expirationDate"]; present {
		t.Errorf("expirationDate present on an unlimited record: %s", created.Body.String())
	}
	id := body["id"].(string)

	updated := f.do(t, http.MethodPut, "/api/proxy-subscriptions/"+id,
		`{"expirationDate": "2026-12-31"}`)
	if got := decodeProxy(t, updated)["expirationDate"]; got != "2026-12-31" {
		t.Fatalf("expirationDate = %v, want 2026-12-31", got)
	}

	cleared := f.do(t, http.MethodPut, "/api/proxy-subscriptions/"+id,
		`{"expirationDate": ""}`)
	if _, present := decodeProxy(t, cleared)["expirationDate"]; present {
		t.Errorf("cleared body still carries expirationDate: %s", cleared.Body.String())
	}
}

// TestProxySubscriptionRoutesReportValidationErrors locks the old stack's 400
// messages: they are surfaced to the user verbatim.
func TestProxySubscriptionRoutesReportValidationErrors(t *testing.T) {
	f := newProxyFixture(t)

	cases := []struct {
		name string
		body string
		want string
	}{
		{"blank name", `{"name":"  ","monthlyPrice":1}`, "代理订阅名称不能为空"},
		{"missing price", `{"name":"Relay"}`, "单月价格不能为空"},
		{"negative price", `{"name":"Relay","monthlyPrice":-1}`, "单月价格必须是非负数字"},
		{"bad date", `{"name":"Relay","monthlyPrice":1,"expirationDate":"2026-02-30"}`, "到期日期必须是 YYYY-MM-DD 格式的有效日期"},
		{"bad website", `{"name":"Relay","monthlyPrice":1,"website":"ftp://example.com"}`, "网站地址必须是有效的 http 或 https 地址"},
		{"bad status", `{"name":"Relay","monthlyPrice":1,"status":"archived"}`, "无效的代理订阅状态"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			rec := f.do(t, http.MethodPost, "/api/proxy-subscriptions", testCase.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if got := decodeProxy(t, rec)["error"]; got != testCase.want {
				t.Errorf("error = %v, want %q", got, testCase.want)
			}
		})
	}

	invalidJSON := f.do(t, http.MethodPost, "/api/proxy-subscriptions", "{")
	if invalidJSON.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON status = %d, want 400", invalidJSON.Code)
	}
	if got := decodeProxy(t, invalidJSON)["error"]; got != "Invalid JSON in request body" {
		t.Errorf("error = %v, want Invalid JSON in request body", got)
	}

	missingUpdate := f.do(t, http.MethodPut, "/api/proxy-subscriptions/nope", `{"status":"in-use"}`)
	if missingUpdate.Code != http.StatusNotFound {
		t.Fatalf("PUT unknown status = %d, want 404", missingUpdate.Code)
	}
	missingDelete := f.do(t, http.MethodDelete, "/api/proxy-subscriptions/nope", "")
	if missingDelete.Code != http.StatusNotFound {
		t.Fatalf("DELETE unknown status = %d, want 404", missingDelete.Code)
	}
}

// TestProxyTagsRouteReadsMutableTagsDynamically is the parity port of
// __tests__/proxy-tags-route.test.ts ("reads mutable proxy tags
// dynamically"): every read hits current data, so a tag created by a write is
// visible on the very next GET.
func TestProxyTagsRouteReadsMutableTagsDynamically(t *testing.T) {
	f := newProxyFixture(t)

	empty := f.do(t, http.MethodGet, "/api/proxy-tags", "")
	if empty.Code != http.StatusOK {
		t.Fatalf("GET tags status = %d, want 200", empty.Code)
	}
	var initial []map[string]any
	if err := json.Unmarshal(empty.Body.Bytes(), &initial); err != nil {
		t.Fatalf("decode tags: %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("initial tags = %s, want []", empty.Body.String())
	}

	created := f.do(t, http.MethodPost, "/api/proxy-subscriptions",
		`{"name":"Relay","monthlyPrice":5,"tagNames":["备用"]}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("POST status = %d (body=%s)", created.Code, created.Body.String())
	}
	subscriptionID := decodeProxy(t, created)["id"].(string)

	after := f.do(t, http.MethodGet, "/api/proxy-tags", "")
	var tags []map[string]any
	if err := json.Unmarshal(after.Body.Bytes(), &tags); err != nil {
		t.Fatalf("decode tags: %v", err)
	}
	if len(tags) != 1 || tags[0]["name"] != "备用" {
		t.Fatalf("tags after create = %s, want [备用]", after.Body.String())
	}
	tagID := tags[0]["id"].(string)

	renamed := f.do(t, http.MethodPatch, "/api/proxy-tags/"+tagID, `{"name":"工作"}`)
	if renamed.Code != http.StatusOK {
		t.Fatalf("PATCH status = %d, want 200 (body=%s)", renamed.Code, renamed.Body.String())
	}
	if got := decodeProxy(t, renamed)["name"]; got != "工作" {
		t.Errorf("renamed name = %v, want 工作", got)
	}

	duplicate := f.do(t, http.MethodPatch, "/api/proxy-tags/"+tagID, `{"name":" , "}`)
	if duplicate.Code != http.StatusBadRequest {
		t.Fatalf("PATCH invalid name status = %d, want 400", duplicate.Code)
	}
	if got := decodeProxy(t, duplicate)["error"]; got != "标签不能包含中英文逗号或换行" {
		t.Errorf("error = %v, want the separator message", got)
	}

	missingTag := f.do(t, http.MethodPatch, "/api/proxy-tags/nope", `{"name":"x"}`)
	if missingTag.Code != http.StatusNotFound {
		t.Fatalf("PATCH unknown status = %d, want 404", missingTag.Code)
	}
	if got := decodeProxy(t, missingTag)["error"]; got != "标签不存在" {
		t.Errorf("error = %v, want 标签不存在", got)
	}

	deleted := f.do(t, http.MethodDelete, "/api/proxy-tags/"+tagID, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("DELETE tag status = %d, want 200 (body=%s)", deleted.Code, deleted.Body.String())
	}
	deletedBody := decodeProxy(t, deleted)
	if deletedBody["tagId"] != tagID {
		t.Errorf("tagId = %v, want %q", deletedBody["tagId"], tagID)
	}
	affected, ok := deletedBody["affectedSubscriptionIds"].([]any)
	if !ok || len(affected) != 1 || affected[0] != subscriptionID {
		t.Errorf("affectedSubscriptionIds = %v, want [%q]", deletedBody["affectedSubscriptionIds"], subscriptionID)
	}

	// The tag is gone from the catalog but the subscription survives.
	final := f.do(t, http.MethodGet, "/api/proxy-tags", "")
	if body := final.Body.String(); body != "[]" {
		t.Errorf("tags after delete = %s, want []", body)
	}
	surviving := f.do(t, http.MethodGet, "/api/proxy-subscriptions/"+subscriptionID, "")
	if surviving.Code != http.StatusOK {
		t.Fatalf("GET subscription status = %d, want 200", surviving.Code)
	}
	if tagIDs, ok := decodeProxy(t, surviving)["tagIds"].([]any); !ok || len(tagIDs) != 0 {
		t.Errorf("tagIds after tag delete = %v, want []", decodeProxy(t, surviving)["tagIds"])
	}
}

// TestProxyRoutesRequireSession locks middleware parity: the old stack gated
// every /api path except /api/auth, so proxy routes answer 401 anonymously.
func TestProxyRoutesRequireSession(t *testing.T) {
	f := newProxyFixture(t)
	for _, path := range []string{"/api/proxy-subscriptions", "/api/proxy-tags"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		f.handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("anonymous GET %s = %d, want 401", path, rec.Code)
		}
	}
}
