// Package notify holds the notification domain: channel vocabulary, webhook
// signing, payload construction and the HTTP sender. It is a 1:1 port of
// lib/notifications/{channel-validate,signing,payload}.ts — the old stack is
// the behavioural spec, so wire shapes and error semantics are unchanged.
package notify

import (
	"net/url"
	"strings"

	"ai-subscriptions/internal/model"
)

// Channel types supported by the system (VALID_CHANNEL_TYPES).
const (
	TypeDingtalk  = "dingtalk"
	TypeFeishu    = "feishu"
	TypeWebhook   = "webhook"
	TypeFeishuApp = "feishu-app"
)

// ValidChannelTypes is the runtime allow-list routes validate `type` against.
var ValidChannelTypes = []string{TypeDingtalk, TypeFeishu, TypeWebhook, TypeFeishuApp}

// IsWebhookChannelType reports whether the type is delivered by posting to a
// webhook URL (dingtalk/feishu/webhook) rather than via app credentials.
func IsWebhookChannelType(channelType string) bool {
	return channelType == TypeDingtalk || channelType == TypeFeishu || channelType == TypeWebhook
}

// IsFeishuAppChannelType reports whether the type uses appId/appSecret.
func IsFeishuAppChannelType(channelType string) bool {
	return channelType == TypeFeishuApp
}

// IsValidChannelType reports whether the type is in ValidChannelTypes.
func IsValidChannelType(channelType string) bool {
	for _, valid := range ValidChannelTypes {
		if channelType == valid {
			return true
		}
	}
	return false
}

// SafeWebhookURL accepts only absolute http(s) URLs, returning the trimmed
// value; ok is false otherwise. The same check gates stored channels so a
// test send can never be aimed at file:// or a bare path.
func SafeWebhookURL(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	if parsed.Host == "" {
		return "", false
	}
	return trimmed, true
}

// SafeNonEmptyString returns the trimmed value and true when it is non-empty.
func SafeNonEmptyString(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	return trimmed, trimmed != ""
}

// SafeReceiveIDType accepts only the two Feishu receive-id scopes.
func SafeReceiveIDType(raw string) (string, bool) {
	if raw == "open_id" || raw == "chat_id" {
		return raw, true
	}
	return "", false
}

// PublicChannel is a channel as returned to the client: the signing secrets are
// replaced by hasSecret/hasAppSecret flags so the UI can offer
// keep/change/clear without ever seeing the value (sanitizeChannelForClient).
type PublicChannel struct {
	ID             string            `json:"id"`
	Type           string            `json:"type"`
	Name           string            `json:"name"`
	URL            string            `json:"url,omitempty"`
	AppID          string            `json:"appId,omitempty"`
	ReceiveID      string            `json:"receiveId,omitempty"`
	ReceiveIDType  string            `json:"receiveIdType,omitempty"`
	Enabled        bool              `json:"enabled"`
	LastSendResult *model.SendResult `json:"lastSendResult,omitempty"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
	HasSecret      bool              `json:"hasSecret"`
	HasAppSecret   bool              `json:"hasAppSecret"`
}

// SanitizeChannel strips secret/appSecret and reports their presence instead.
func SanitizeChannel(channel model.NotificationChannel) PublicChannel {
	return PublicChannel{
		ID:             channel.ID,
		Type:           channel.Type,
		Name:           channel.Name,
		URL:            channel.URL,
		AppID:          channel.AppID,
		ReceiveID:      channel.ReceiveID,
		ReceiveIDType:  channel.ReceiveIDType,
		Enabled:        channel.Enabled,
		LastSendResult: channel.LastSendResult,
		CreatedAt:      channel.CreatedAt,
		UpdatedAt:      channel.UpdatedAt,
		HasSecret:      channel.Secret != "",
		HasAppSecret:   channel.AppSecret != "",
	}
}

// SanitizeChannels maps SanitizeChannel over a slice, always returning a
// non-nil slice so the wire carries `[]` rather than `null`.
func SanitizeChannels(channels []model.NotificationChannel) []PublicChannel {
	out := make([]PublicChannel, 0, len(channels))
	for _, channel := range channels {
		out = append(out, SanitizeChannel(channel))
	}
	return out
}
