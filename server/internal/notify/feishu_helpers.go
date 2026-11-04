package notify

// Feishu settings-page helpers, ported from
// lib/notifications/feishu-helpers.ts: list the chats the bot belongs to (so
// the user can pick a chat_id) and resolve phone numbers/emails to open_ids (so
// the user can pick a receive_id). Both reuse the app-bot client's token cache
// and HTTP seam, and both route failures through the scope-aware translator.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	feishuChatsPath      = "/open-apis/im/v1/chats"
	feishuBatchGetIDPath = "/open-apis/contact/v3/users/batch_get_id"

	feishuDefaultChatPageSize = 50
)

// FeishuChat is one chat the bot is a member of.
type FeishuChat struct {
	ChatID      string `json:"chat_id"`
	Name        string `json:"name"`
	Avatar      string `json:"avatar,omitempty"`
	Description string `json:"description,omitempty"`
	OwnerID     string `json:"owner_id,omitempty"`
	ChatType    string `json:"chat_type,omitempty"`
}

// FeishuChatList is the paginated chat listing.
type FeishuChatList struct {
	Items     []FeishuChat `json:"items"`
	HasMore   bool         `json:"has_more"`
	PageToken string       `json:"page_token,omitempty"`
}

// ChatListOptions carries the optional pagination parameters; zero values mean
// "use the defaults".
type ChatListOptions struct {
	PageSize  int
	PageToken string
}

// FeishuUserID is the id triple Feishu returns for a resolved user.
type FeishuUserID struct {
	OpenID  string `json:"open_id"`
	UnionID string `json:"union_id,omitempty"`
	UserID  string `json:"user_id,omitempty"`
}

// FeishuUser is one resolved user.
type FeishuUser struct {
	UserID FeishuUserID `json:"user_id"`
	Mobile string       `json:"mobile,omitempty"`
	Email  string       `json:"email,omitempty"`
}

// FeishuUserLookup is the batch_resolve result.
type FeishuUserLookup struct {
	UserList []FeishuUser `json:"user_list"`
}

// ListChats lists the chats the bot belongs to. Scope: im:chat:readonly.
func (c *FeishuClient) ListChats(ctx context.Context, appID, appSecret string, opts ChatListOptions) (FeishuChatList, error) {
	token, err := c.TenantToken(ctx, appID, appSecret, false)
	if err != nil {
		return FeishuChatList{}, err
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = feishuDefaultChatPageSize
	}
	query := url.Values{}
	query.Set("page_size", strconv.Itoa(pageSize))
	if opts.PageToken != "" {
		query.Set("page_token", opts.PageToken)
	}

	var data struct {
		Items     []FeishuChat `json:"items"`
		HasMore   bool         `json:"has_more"`
		PageToken string       `json:"page_token"`
	}
	if err := c.getFeishuJSON(ctx, c.baseURL+feishuChatsPath+"?"+query.Encode(), token, "获取群列表失败", &data); err != nil {
		return FeishuChatList{}, err
	}

	items := data.Items
	if items == nil {
		items = []FeishuChat{}
	}
	return FeishuChatList{Items: items, HasMore: data.HasMore, PageToken: data.PageToken}, nil
}

// LookupUsersByPhone resolves phone numbers to users.
// Scope: contact:user.id:readonly.
func (c *FeishuClient) LookupUsersByPhone(ctx context.Context, appID, appSecret string, mobiles []string) (FeishuUserLookup, error) {
	return c.LookupUsers(ctx, appID, appSecret, mobiles, nil)
}

// LookupUsers resolves phone numbers and/or emails to users in one call, so the
// picker can offer both lookup modes the settings page exposes.
func (c *FeishuClient) LookupUsers(ctx context.Context, appID, appSecret string, mobiles, emails []string) (FeishuUserLookup, error) {
	if len(mobiles) == 0 && len(emails) == 0 {
		return FeishuUserLookup{}, fmt.Errorf("手机号列表不能为空")
	}

	token, err := c.TenantToken(ctx, appID, appSecret, false)
	if err != nil {
		return FeishuUserLookup{}, err
	}

	requestBody := make(map[string][]string, 2)
	if len(mobiles) > 0 {
		requestBody["mobiles"] = mobiles
	}
	if len(emails) > 0 {
		requestBody["emails"] = emails
	}
	encoded, err := json.Marshal(requestBody)
	if err != nil {
		return FeishuUserLookup{}, err
	}

	var data struct {
		UserList []FeishuUser `json:"user_list"`
	}
	if err := c.postFeishuJSON(ctx, c.baseURL+feishuBatchGetIDPath, token, string(encoded), "手机号反查失败", &data); err != nil {
		return FeishuUserLookup{}, err
	}

	users := data.UserList
	if users == nil {
		users = []FeishuUser{}
	}
	return FeishuUserLookup{UserList: users}, nil
}

// getFeishuJSON issues an authenticated GET and decodes the standard envelope.
func (c *FeishuClient) getFeishuJSON(ctx context.Context, endpoint, token, label string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	return c.doFeishuJSON(request, label, target)
}

// postFeishuJSON issues an authenticated POST and decodes the envelope.
func (c *FeishuClient) postFeishuJSON(ctx context.Context, endpoint, token, payload, label string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	return c.doFeishuJSON(request, label, target)
}

// doFeishuJSON executes the request and unwraps {code,msg,data}. Failures go
// through the translator so a missing scope is named in the error.
func (c *FeishuClient) doFeishuJSON(request *http.Request, label string, target any) error {
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)

	var envelope struct {
		Code *int            `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if len(body) > 0 {
		_ = json.Unmarshal(body, &envelope)
	}

	if response.StatusCode < 200 || response.StatusCode > 299 {
		code := 0
		if envelope.Code != nil {
			code = *envelope.Code
		}
		msg := envelope.Msg
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", response.StatusCode)
		}
		return NewFeishuAPIError(code, msg, label)
	}
	if envelope.Code != nil && *envelope.Code != 0 {
		return NewFeishuAPIError(*envelope.Code, envelope.Msg, label)
	}

	if target != nil && len(envelope.Data) > 0 {
		if err := json.Unmarshal(envelope.Data, target); err != nil {
			return fmt.Errorf("%s: unexpected response body: %w", label, err)
		}
	}
	return nil
}
