package notify

// Parity port of __tests__/feishu-helpers.test.ts (13 cases): the scope-aware
// error translator plus the two settings-page helpers — list the bot's chats
// and resolve a phone number to an open_id. Both helpers reuse the app-bot
// client's tenant token cache and HTTP seam.

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// ---------- error translation (5 cases) ----------

func TestTranslateFeishuErrorTokenInvalid(t *testing.T) {
	message, known := TranslateFeishuError(99991663, "")
	if !known {
		t.Fatal("99991663 not translated")
	}
	if !strings.Contains(message, "app_access_token") || !strings.Contains(message, "无效") {
		t.Errorf("message = %q, want the invalid app_access_token hint", message)
	}
}

func TestTranslateFeishuErrorTenantToken(t *testing.T) {
	message, known := TranslateFeishuError(99991664, "")
	if !known {
		t.Fatal("99991664 not translated")
	}
	if !strings.Contains(message, "tenant_access_token") {
		t.Errorf("message = %q, want the tenant_access_token hint", message)
	}
}

func TestTranslateFeishuErrorPermissionDenied(t *testing.T) {
	message, known := TranslateFeishuError(99991400, "")
	if !known {
		t.Fatal("99991400 not translated")
	}
	if !strings.Contains(message, "权限不足") || !strings.Contains(message, "飞书开放平台") {
		t.Errorf("message = %q, want the permission hint", message)
	}
}

func TestTranslateFeishuErrorScopeNames(t *testing.T) {
	message, known := TranslateFeishuError(99991672, "missing scope: im:chat:readonly")
	if !known {
		t.Fatal("99991672 not translated")
	}
	if !strings.Contains(message, "权限不足") || !strings.Contains(message, "im:chat:readonly") {
		t.Errorf("message = %q, want the missing scope named", message)
	}
}

func TestTranslateFeishuErrorUnknownCode(t *testing.T) {
	if _, known := TranslateFeishuError(9999999, ""); known {
		t.Fatal("unknown code was translated, want it surfaced raw")
	}
}

// ---------- chat list (4 cases) ----------

func TestFeishuListChatsFetchesWithTokenAuth(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":0,"data":{"items":[{"chat_id":"oc_abc","name":"Test Group"},{"chat_id":"oc_def","name":"Another Group"}],"has_more":false}}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	result, err := client.ListChats(context.Background(), "app-id", "app-secret", ChatListOptions{})
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(result.Items))
	}
	if result.Items[0].ChatID != "oc_abc" || result.Items[0].Name != "Test Group" {
		t.Errorf("first chat = %+v, want oc_abc/Test Group", result.Items[0])
	}
	if result.HasMore {
		t.Error("has_more = true, want false")
	}

	request := transport.request(t, 1)
	if !strings.Contains(request.url, "/open-apis/im/v1/chats") {
		t.Errorf("url = %q, want the chats endpoint", request.url)
	}
	if !strings.Contains(request.url, "page_size=50") {
		t.Errorf("url = %q, want the default page_size=50", request.url)
	}
	if request.header.Get("Authorization") != "Bearer t-token" {
		t.Errorf("Authorization = %q, want the tenant token", request.header.Get("Authorization"))
	}
}

func TestFeishuListChatsSupportsPagination(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":0,"data":{"items":[{"chat_id":"oc_page2","name":"Page 2 Group"}],"has_more":false,"page_token":"prev_token"}}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	result, err := client.ListChats(context.Background(), "app-id", "app-secret", ChatListOptions{
		PageToken: "some_token",
		PageSize:  10,
	})
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	request := transport.request(t, 1)
	if !strings.Contains(request.url, "page_token=some_token") {
		t.Errorf("url = %q, want page_token=some_token", request.url)
	}
	if !strings.Contains(request.url, "page_size=10") {
		t.Errorf("url = %q, want page_size=10", request.url)
	}
	if len(result.Items) != 1 || result.Items[0].ChatID != "oc_page2" {
		t.Errorf("items = %+v, want the second page", result.Items)
	}
}

func TestFeishuListChatsTranslatesNonZeroCode(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":99991400,"msg":"permission denied"}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	_, err := client.ListChats(context.Background(), "app-id", "app-secret", ChatListOptions{})
	if err == nil || !strings.Contains(err.Error(), "权限不足") {
		t.Fatalf("err = %v, want the translated permission error", err)
	}
}

func TestFeishuListChatsTranslatesHTTPError(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{status: http.StatusUnauthorized, body: `{"code":99991663,"msg":"invalid token"}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	_, err := client.ListChats(context.Background(), "app-id", "app-secret", ChatListOptions{})
	if err == nil || !strings.Contains(err.Error(), "app_access_token") {
		t.Fatalf("err = %v, want the invalid-token translation", err)
	}
}

// ---------- user lookup by phone (4 cases) ----------

func TestFeishuLookupUserByPhone(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":0,"data":{"user_list":[{"user_id":{"open_id":"ou_abc123"},"mobile":"+8613800138000"}]}}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	result, err := client.LookupUsersByPhone(context.Background(), "app-id", "app-secret", []string{"+8613800138000"})
	if err != nil {
		t.Fatalf("LookupUsersByPhone: %v", err)
	}
	if len(result.UserList) != 1 {
		t.Fatalf("user_list = %d, want 1", len(result.UserList))
	}
	if result.UserList[0].UserID.OpenID != "ou_abc123" {
		t.Errorf("open_id = %q, want ou_abc123", result.UserList[0].UserID.OpenID)
	}
	if result.UserList[0].Mobile != "+8613800138000" {
		t.Errorf("mobile = %q, want the queried number", result.UserList[0].Mobile)
	}

	request := transport.request(t, 1)
	if request.url != "https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id" {
		t.Errorf("url = %q, want the batch_get_id endpoint", request.url)
	}
	if request.method != http.MethodPost {
		t.Errorf("method = %q, want POST", request.method)
	}
	var body map[string][]string
	if err := json.Unmarshal([]byte(request.body), &body); err != nil {
		t.Fatalf("decode body %q: %v", request.body, err)
	}
	if len(body["mobiles"]) != 1 || body["mobiles"][0] != "+8613800138000" {
		t.Errorf("body = %v, want the mobiles array", body)
	}
}

func TestFeishuLookupUserByPhoneRejectsEmptyList(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{}
	client := feishuClientFor(transport, &nowMs)

	_, err := client.LookupUsersByPhone(context.Background(), "app-id", "app-secret", nil)
	if err == nil || !strings.Contains(err.Error(), "不能为空") {
		t.Fatalf("err = %v, want the empty-list error", err)
	}
	if transport.callCount() != 0 {
		t.Errorf("calls = %d, want no request for an empty list", transport.callCount())
	}
}

func TestFeishuLookupUserByPhoneTranslatesPermissionError(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":99991672,"msg":"missing scope: contact:user.id:readonly"}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	_, err := client.LookupUsersByPhone(context.Background(), "app-id", "app-secret", []string{"+8613800138000"})
	if err == nil || !strings.Contains(err.Error(), "contact:user.id:readonly") {
		t.Fatalf("err = %v, want the missing scope named", err)
	}
}

func TestFeishuLookupUserByPhoneReturnsEmptyList(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":0,"data":{"user_list":[]}}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	result, err := client.LookupUsersByPhone(context.Background(), "app-id", "app-secret", []string{"+8613800138000"})
	if err != nil {
		t.Fatalf("LookupUsersByPhone: %v", err)
	}
	if len(result.UserList) != 0 {
		t.Errorf("user_list = %v, want empty", result.UserList)
	}
}

// ---------- user lookup by email (ticket addition) ----------

func TestFeishuLookupUsersByEmail(t *testing.T) {
	nowMs := int64(1000000)
	transport := &fakeTransport{responses: []fakeResponse{
		tokenOK("t-token"),
		{body: `{"code":0,"data":{"user_list":[{"user_id":{"open_id":"ou_email"},"email":"a@example.com"}]}}`},
	}}
	client := feishuClientFor(transport, &nowMs)

	result, err := client.LookupUsers(context.Background(), "app-id", "app-secret", nil, []string{"a@example.com"})
	if err != nil {
		t.Fatalf("LookupUsers: %v", err)
	}
	if len(result.UserList) != 1 || result.UserList[0].UserID.OpenID != "ou_email" {
		t.Fatalf("user_list = %+v, want the email match", result.UserList)
	}
	var body map[string][]string
	if err := json.Unmarshal([]byte(transport.request(t, 1).body), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body["emails"]) != 1 || body["emails"][0] != "a@example.com" {
		t.Errorf("body = %v, want the emails array", body)
	}
}
