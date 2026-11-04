package notify

// Feishu app-bot channel, ported from lib/notifications/feishu-app.ts.
//
// Token lifecycle: tenant_access_token expires in ~2h. Tokens are cached in
// process memory (keyed by appId) and treated as expired 5 minutes early so a
// send never races the server. A 401 or Feishu code 99991663 means the token
// went bad: the client force-refreshes once and retries the send.
//
// The cache is process-resident on purpose (ADR-0018): a restart starts cold,
// which matches the old stack's in-memory module state.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"ai-subscriptions/internal/model"
)

const (
	feishuBaseURL         = "https://open.feishu.cn"
	feishuTenantTokenPath = "/open-apis/auth/v3/tenant_access_token/internal"
	feishuMessagePath     = "/open-apis/im/v1/messages"

	// feishuTokenExpiryBuffer expires tokens early to avoid racing the server.
	feishuTokenExpiryBuffer = 5 * time.Minute
	// feishuDefaultTokenTTL is used when the response omits `expire`.
	feishuDefaultTokenTTL = 7200 * time.Second
)

// HTTPDoer is the HTTP seam. *http.Client satisfies it; tests inject a scripted
// transport so no live tenant is required.
type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type cachedFeishuToken struct {
	token     string
	expiresAt time.Time
}

// FeishuClient is the app-bot client: tenant-token cache plus message sends.
type FeishuClient struct {
	http    HTTPDoer
	now     func() time.Time
	baseURL string

	mu     sync.Mutex
	tokens map[string]cachedFeishuToken
}

// NewFeishuClient builds a client. nil doer/now fall back to production
// defaults, so callers only inject seams in tests.
func NewFeishuClient(doer HTTPDoer, now func() time.Time) *FeishuClient {
	if doer == nil {
		doer = http.DefaultClient
	}
	if now == nil {
		now = time.Now
	}
	return &FeishuClient{
		http:    doer,
		now:     now,
		baseURL: feishuBaseURL,
		tokens:  make(map[string]cachedFeishuToken),
	}
}

// TenantToken returns a valid tenant_access_token for the app, fetching a new
// one when the cache is cold/expired or forceRefresh is set.
func (c *FeishuClient) TenantToken(ctx context.Context, appID, appSecret string, forceRefresh bool) (string, error) {
	now := c.now()

	c.mu.Lock()
	cached, found := c.tokens[appID]
	c.mu.Unlock()
	if !forceRefresh && found && cached.expiresAt.After(now) {
		return cached.token, nil
	}

	requestBody, err := json.Marshal(map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	})
	if err != nil {
		return "", err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+feishuTenantTokenPath, strings.NewReader(string(requestBody)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)

	if response.StatusCode < 200 || response.StatusCode > 299 {
		message := fmt.Sprintf("Failed to fetch feishu tenant token: HTTP %d %s",
			response.StatusCode, http.StatusText(response.StatusCode))
		if len(body) > 0 {
			message += ": " + string(body)
		}
		return "", fmt.Errorf("%s", message)
	}

	var decoded struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            *int   `json:"expire"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return "", fmt.Errorf("Failed to fetch feishu tenant token: invalid response: %v", err)
	}
	if decoded.Code != 0 || decoded.TenantAccessToken == "" {
		label := decoded.Msg
		if label == "" {
			label = "unknown"
		}
		return "", fmt.Errorf("Failed to fetch feishu tenant token: code=%d msg=%s", decoded.Code, label)
	}

	expire := feishuDefaultTokenTTL
	if decoded.Expire != nil {
		expire = time.Duration(*decoded.Expire) * time.Second
	}
	token := cachedFeishuToken{
		token:     decoded.TenantAccessToken,
		expiresAt: now.Add(expire - feishuTokenExpiryBuffer),
	}

	c.mu.Lock()
	c.tokens[appID] = token
	c.mu.Unlock()
	return token.token, nil
}

// ClearTokenCache drops one app's cached token, or every token when appID is
// empty.
func (c *FeishuClient) ClearTokenCache(appID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if appID == "" {
		c.tokens = make(map[string]cachedFeishuToken)
		return
	}
	delete(c.tokens, appID)
}

// FeishuAppCredentials are a validated feishu-app channel's send target.
type FeishuAppCredentials struct {
	AppID         string
	AppSecret     string
	ReceiveID     string
	ReceiveIDType string
}

// FeishuAppCredentialsFor validates and extracts send credentials from a
// channel. Both the dispatcher and the test-send route use it, so validation
// messages stay identical.
func FeishuAppCredentialsFor(channel model.NotificationChannel) (FeishuAppCredentials, error) {
	if channel.Type != TypeFeishuApp {
		return FeishuAppCredentials{}, fmt.Errorf("Channel %s is not a feishu-app channel", channel.ID)
	}
	if channel.AppID == "" || channel.AppSecret == "" || channel.ReceiveID == "" || channel.ReceiveIDType == "" {
		return FeishuAppCredentials{}, fmt.Errorf(
			"feishu-app channel %s is missing required fields (appId/appSecret/receiveId/receiveIdType)", channel.ID)
	}
	return FeishuAppCredentials{
		AppID:         channel.AppID,
		AppSecret:     channel.AppSecret,
		ReceiveID:     channel.ReceiveID,
		ReceiveIDType: channel.ReceiveIDType,
	}, nil
}

// BuildFeishuAppCard renders the event as the interactive-card JSON string that
// Feishu expects in a message's `content`. Credential auth has no keyword
// security, so the title never carries the 【AI订阅】 prefix.
func BuildFeishuAppCard(event Event) (string, error) {
	title, body := BuildEventMarkdown(event, false)
	encoded, err := json.Marshal(BuildFeishuCard(title, body))
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// Send delivers event through the app bot. Errors route through
// NewFeishuAPIError so missing scopes surface their permission names.
func (c *FeishuClient) Send(ctx context.Context, event Event, creds FeishuAppCredentials) error {
	content, err := BuildFeishuAppCard(event)
	if err != nil {
		return err
	}
	return c.sendWithRetry(ctx, creds, content, false)
}

// SendToChannel validates the channel credentials and sends the event, routing
// feishu-app channels through the app bot (the counterpart of the old
// dispatcher's defaultFeishuAppSender).
func (c *FeishuClient) SendToChannel(ctx context.Context, event Event, channel model.NotificationChannel) error {
	creds, err := FeishuAppCredentialsFor(channel)
	if err != nil {
		return err
	}
	return c.Send(ctx, event, creds)
}

func (c *FeishuClient) sendWithRetry(ctx context.Context, creds FeishuAppCredentials, content string, forceRefresh bool) error {
	token, err := c.TenantToken(ctx, creds.AppID, creds.AppSecret, forceRefresh)
	if err != nil {
		return err
	}

	requestBody, err := json.Marshal(map[string]string{
		"receive_id": creds.ReceiveID,
		"msg_type":   "interactive",
		"content":    content,
	})
	if err != nil {
		return err
	}

	endpoint := c.baseURL + feishuMessagePath + "?receive_id_type=" + url.QueryEscape(creds.ReceiveIDType)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(requestBody)))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)

	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	bodyText, _ := io.ReadAll(response.Body)

	var bodyJSON struct {
		Code *int   `json:"code"`
		Msg  string `json:"msg"`
	}
	if len(bodyText) > 0 {
		_ = json.Unmarshal(bodyText, &bodyJSON)
	}

	tokenInvalid := response.StatusCode == http.StatusUnauthorized ||
		(bodyJSON.Code != nil && *bodyJSON.Code == 99991663)
	if tokenInvalid && !forceRefresh {
		return c.sendWithRetry(ctx, creds, content, true)
	}

	if response.StatusCode < 200 || response.StatusCode > 299 {
		if bodyJSON.Code != nil {
			return NewFeishuAPIError(*bodyJSON.Code, bodyJSON.Msg, "发送消息失败")
		}
		message := fmt.Sprintf("发送消息失败: HTTP %d %s", response.StatusCode, http.StatusText(response.StatusCode))
		if len(bodyText) > 0 {
			message += ": " + string(bodyText)
		}
		return fmt.Errorf("%s", message)
	}
	if bodyJSON.Code != nil && *bodyJSON.Code != 0 {
		return NewFeishuAPIError(*bodyJSON.Code, bodyJSON.Msg, "发送消息失败")
	}
	return nil
}

// defaultFeishuClient is the process-wide app-bot client: its token cache is
// the process-resident state ADR-0018 calls for.
var defaultFeishuClient = NewFeishuClient(nil, nil)

// DefaultFeishuClient returns the process-wide app-bot client.
func DefaultFeishuClient() *FeishuClient { return defaultFeishuClient }
