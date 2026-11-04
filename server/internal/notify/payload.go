package notify

// Payload construction, ported from lib/notifications/payload.ts. Only the
// low-balance branch is needed here: the only thing #37 puts on the wire is a
// channel test send, which uses a synthetic low-balance event. The reset
// branch and the full event dispatcher belong to #39.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ai-subscriptions/internal/model"
)

// Event is one notification event. Kind discriminates the payload shape.
type Event struct {
	Kind         string
	Subscription model.Subscription
	Balance      float64
	Threshold    float64
	TriggeredAt  string
}

// PreparedSend is a channel-specific (URL, body, headers) triple.
type PreparedSend struct {
	Channel model.NotificationChannel
	URL     string
	Body    []byte
	Headers map[string]string
}

// DingtalkPayload is the DingTalk markdown message envelope.
type DingtalkPayload struct {
	MsgType  string `json:"msgtype"`
	Markdown struct {
		Title string `json:"title"`
		Text  string `json:"text"`
	} `json:"markdown"`
}

// FeishuCard is the Feishu interactive-card structure.
type FeishuCard struct {
	Header struct {
		Title struct {
			Tag     string `json:"tag"`
			Content string `json:"content"`
		} `json:"title"`
	} `json:"header"`
	Elements []FeishuCardElement `json:"elements"`
}

// FeishuCardElement is one markdown block inside a card.
type FeishuCardElement struct {
	Tag     string `json:"tag"`
	Content string `json:"content"`
}

// FeishuPayload is the Feishu interactive-card envelope. Timestamp/Sign are
// present only when the channel carries a signing secret.
type FeishuPayload struct {
	MsgType   string     `json:"msg_type"`
	Card      FeishuCard `json:"card"`
	Timestamp string     `json:"timestamp,omitempty"`
	Sign      string     `json:"sign,omitempty"`
}

// WebhookSubscription is the platform-agnostic subscription projection.
type WebhookSubscription struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Category         string  `json:"category"`
	Provider         string  `json:"provider"`
	SubscriptionType string  `json:"subscriptionType"`
	Price            float64 `json:"price"`
}

// WebhookPayload is the generic webhook envelope.
type WebhookPayload struct {
	Event        string              `json:"event"`
	Timestamp    string              `json:"timestamp"`
	Subscription WebhookSubscription `json:"subscription"`
	Balance      *float64            `json:"balance,omitempty"`
	Threshold    *float64            `json:"threshold,omitempty"`
}

// BuildFeishuCard wraps a title and markdown body in a one-element card.
func BuildFeishuCard(title, body string) FeishuCard {
	card := FeishuCard{Elements: []FeishuCardElement{{Tag: "markdown", Content: body}}}
	card.Header.Title.Tag = "plain_text"
	card.Header.Title.Content = title
	return card
}

// BuildLowBalanceMarkdown builds the alert title and body. Channels without a
// signing secret are assumed to use keyword security, so the keyword "AI订阅"
// is woven into the title.
func BuildLowBalanceMarkdown(sub model.Subscription, balance, threshold float64, includeKeyword bool, triggeredAt string) (title, body string) {
	if includeKeyword {
		title = fmt.Sprintf("【AI订阅】🪫 %s 余额不足提醒", sub.Name)
	} else {
		title = fmt.Sprintf("🪫 %s 余额不足", sub.Name)
	}
	lines := []string{
		"- **订阅**: " + sub.Name,
		"- **提供商**: " + sub.Provider,
		"- **当前余额**: " + formatNumber(balance),
		"- **阈值**: " + formatNumber(threshold),
		"- **时间**: " + formatLocalTime(triggeredAt),
	}
	return title, joinLines(lines)
}

// formatNumber renders a float the way JavaScript's String(number) does for the
// magnitudes balances and thresholds take.
func formatNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// formatLocalTime renders the event timestamp like
// `new Date(iso).toLocaleString("zh-CN")` in the server's local zone.
func formatLocalTime(iso string) string {
	parsed, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return iso
	}
	return parsed.Local().Format("2006/1/2 15:04:05")
}

func joinLines(lines []string) string {
	var buf bytes.Buffer
	for i, line := range lines {
		if i > 0 {
			buf.WriteByte('\n')
		}
		buf.WriteString(line)
	}
	return buf.String()
}

// BuildWebhookPayload builds the generic webhook body for a low-balance event.
func BuildWebhookPayload(event Event) WebhookPayload {
	balance, threshold := event.Balance, event.Threshold
	return WebhookPayload{
		Event:     event.Kind,
		Timestamp: event.TriggeredAt,
		Subscription: WebhookSubscription{
			ID:               event.Subscription.ID,
			Name:             event.Subscription.Name,
			Category:         event.Subscription.Category,
			Provider:         event.Subscription.Provider,
			SubscriptionType: event.Subscription.SubscriptionType,
			Price:            event.Subscription.Price,
		},
		Balance:   &balance,
		Threshold: &threshold,
	}
}

// BuildDingtalkURL appends timestamp/sign to the webhook URL when the channel
// has a secret, honouring a pre-existing query string.
func BuildDingtalkURL(channel model.NotificationChannel, now time.Time) string {
	if channel.Secret == "" {
		return channel.URL
	}
	sign := ComputeDingtalkSign(channel.Secret, now.UnixMilli())
	if sign == nil {
		return channel.URL
	}
	separator := "?"
	if strings.Contains(channel.URL, "?") {
		separator = "&"
	}
	return fmt.Sprintf("%s%stimestamp=%d&sign=%s", channel.URL, separator, sign.Timestamp, sign.Sign)
}

// PrepareSend builds the channel-specific send for an event. It errors for
// disabled channels and for feishu-app channels, which have a dedicated sender.
func PrepareSend(channel model.NotificationChannel, event Event, now time.Time) (*PreparedSend, error) {
	if !channel.Enabled {
		return nil, fmt.Errorf("cannot prepare send for disabled channel %s", channel.ID)
	}
	includeKeyword := channel.Secret == ""
	headers := map[string]string{"Content-Type": "application/json"}

	switch channel.Type {
	case TypeDingtalk:
		var payload DingtalkPayload
		payload.MsgType = "markdown"
		payload.Markdown.Title, payload.Markdown.Text = BuildLowBalanceMarkdown(
			event.Subscription, event.Balance, event.Threshold, includeKeyword, event.TriggeredAt)
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		return &PreparedSend{Channel: channel, URL: BuildDingtalkURL(channel, now), Body: body, Headers: headers}, nil
	case TypeFeishu:
		title, text := BuildLowBalanceMarkdown(
			event.Subscription, event.Balance, event.Threshold, includeKeyword, event.TriggeredAt)
		payload := FeishuPayload{MsgType: "interactive", Card: BuildFeishuCard(title, text)}
		if channel.Secret != "" {
			if sign := ComputeFeishuSign(channel.Secret, now.Unix()); sign != nil {
				payload.Timestamp = sign.Timestamp
				payload.Sign = sign.Sign
			}
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		return &PreparedSend{Channel: channel, URL: channel.URL, Body: body, Headers: headers}, nil
	case TypeWebhook:
		body, err := json.Marshal(BuildWebhookPayload(event))
		if err != nil {
			return nil, err
		}
		return &PreparedSend{Channel: channel, URL: channel.URL, Body: body, Headers: headers}, nil
	default:
		return nil, fmt.Errorf(
			"prepareSend does not support %s channel %s; use the dedicated sender",
			channel.Type, channel.ID)
	}
}

// HTTPSender posts prepared sends over HTTP.
type HTTPSender struct {
	Client *http.Client
}

// NewHTTPSender returns a sender using client, or http.DefaultClient when nil.
func NewHTTPSender(client *http.Client) *HTTPSender {
	if client == nil {
		client = http.DefaultClient
	}
	return &HTTPSender{Client: client}
}

// Send posts the prepared body and turns a non-2xx response into an error
// carrying the status and the truncated response text, like the old httpSender.
func (s *HTTPSender) Send(send *PreparedSend) error {
	request, err := http.NewRequest(http.MethodPost, send.URL, bytes.NewReader(send.Body))
	if err != nil {
		return err
	}
	for key, value := range send.Headers {
		request.Header.Set(key, value)
	}

	response, err := s.Client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		var text bytes.Buffer
		_, _ = text.ReadFrom(response.Body)
		message := fmt.Sprintf("HTTP %d %s", response.StatusCode, http.StatusText(response.StatusCode))
		if text.Len() > 0 {
			message += ": " + text.String()
		}
		return fmt.Errorf("%s", message)
	}
	return nil
}
