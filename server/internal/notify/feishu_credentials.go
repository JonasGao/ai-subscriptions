package notify

// Feishu credential resolution, ported from lib/notifications/feishu-credentials.ts.
//
// The settings page can either submit appId+appSecret directly (new channel),
// or submit only a channelId and rely on the secret already stored on the
// channel (editing / pickers). The resolution order and the Chinese error
// strings are part of the API contract the SPA renders verbatim.

import (
	"errors"
	"fmt"
	"strings"

	"ai-subscriptions/internal/model"
)

// FeishuResolvedCredentials is a validated appId/appSecret pair.
type FeishuResolvedCredentials struct {
	AppID     string
	AppSecret string
}

// ChannelLookup loads a stored channel by id. A nil result (with a nil error)
// means "no such channel", mirroring the old getChannelById contract.
type ChannelLookup func(id string) (*model.NotificationChannel, error)

// ResolveFeishuCredentials resolves appId/appSecret from a request body.
//
// Order (same as the old resolver):
//  1. appId and appSecret both non-empty in the body → use them.
//  2. body carries channelId and the stored channel has an appSecret → use the
//     stored secret, with the body appId overriding the stored one.
//  3. anything else → an error the UI can display.
func ResolveFeishuCredentials(body map[string]any, lookup ChannelLookup) (FeishuResolvedCredentials, error) {
	appIDFromBody := trimmedStringField(body, "appId")
	appSecretFromBody := trimmedStringField(body, "appSecret")
	if appIDFromBody != "" && appSecretFromBody != "" {
		return FeishuResolvedCredentials{AppID: appIDFromBody, AppSecret: appSecretFromBody}, nil
	}

	channelID := trimmedStringField(body, "channelId")
	if channelID == "" {
		return FeishuResolvedCredentials{}, errors.New(
			"请提供 appId 和 appSecret,或提供已保存渠道的 channelId 以使用已存储的凭据")
	}

	if lookup == nil {
		return FeishuResolvedCredentials{}, fmt.Errorf("渠道 %s 不存在", channelID)
	}
	channel, err := lookup(channelID)
	if err != nil {
		return FeishuResolvedCredentials{}, err
	}
	if channel == nil {
		return FeishuResolvedCredentials{}, fmt.Errorf("渠道 %s 不存在", channelID)
	}
	if channel.Type != TypeFeishuApp {
		return FeishuResolvedCredentials{}, fmt.Errorf("渠道 %s 不是 feishu-app 类型", channelID)
	}
	if channel.AppSecret == "" {
		return FeishuResolvedCredentials{}, fmt.Errorf("渠道 %s 没有已存储的 appSecret,请手动填写", channelID)
	}

	resolvedAppID := appIDFromBody
	if resolvedAppID == "" {
		resolvedAppID = channel.AppID
	}
	if resolvedAppID == "" {
		return FeishuResolvedCredentials{}, errors.New("缺少 appId")
	}
	return FeishuResolvedCredentials{AppID: resolvedAppID, AppSecret: channel.AppSecret}, nil
}

// trimmedStringField mirrors `typeof body[key] === "string" ? body[key].trim() : ""`.
func trimmedStringField(body map[string]any, key string) string {
	value, ok := body[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}
