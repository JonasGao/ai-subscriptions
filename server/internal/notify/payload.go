package notify

// Payload construction, ported from lib/notifications/payload.ts.
//
// BuildEventMarkdown is the shared title/body builder for both event kinds: the
// webhook channels and the credential-based feishu-app card all render the same
// markdown. Event detection and the fan-out dispatcher land with #39; this
// package provides the renderers they use.

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

// Event is one notification event. Kind discriminates the payload shape; the
// reset-only fields are ignored for low-balance events.
type Event struct {
	Kind          string
	Subscription  model.Subscription
	Balance       float64
	Threshold     float64
	ScheduleType  string
	NextResetTime string
	TriggeredAt   string
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

// WebhookPayload is the generic webhook envelope. Balance/Threshold are set
// only for low-balance events; ScheduleType/NextResetTime only for reset
// events, so consumers can switch on the `event` discriminator.
type WebhookPayload struct {
	Event         string              `json:"event"`
	Timestamp     string              `json:"timestamp"`
	Subscription  WebhookSubscription `json:"subscription"`
	Balance       *float64            `json:"balance,omitempty"`
	Threshold     *float64            `json:"threshold,omitempty"`
	ScheduleType  string              `json:"scheduleType,omitempty"`
	NextResetTime string              `json:"nextResetTime,omitempty"`
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
	return buildMarkdownCard(sub, "🪫", "余额不足提醒", "余额不足", []string{
		"- **当前余额**: " + formatNumber(balance),
		"- **阈值**: " + formatNumber(threshold),
	}, includeKeyword, triggeredAt)
}

// FormatScheduleType renders a reset schedule type the way the message reads.
func FormatScheduleType(scheduleType string) string {
	switch scheduleType {
	case "fiveHour":
		return "每5小时"
	case "weekly":
		return "每周"
	case "monthly":
		return "每月"
	}
	return scheduleType
}

// BuildResetMarkdown builds the quota-reset title and body.
func BuildResetMarkdown(sub model.Subscription, scheduleType, nextResetTime string, includeKeyword bool, triggeredAt string) (title, body string) {
	return buildMarkdownCard(sub, "🔄", "配额已重置", "配额已重置", []string{
		"- **重置计划**: " + FormatScheduleType(scheduleType),
		"- **下次重置**: " + formatLocalTime(nextResetTime),
	}, includeKeyword, triggeredAt)
}

// BuildEventMarkdown renders any event to (title, body). It is the single
// dispatch point both the webhook and the feishu-app card renderers share.
func BuildEventMarkdown(event Event, includeKeyword bool) (title, body string) {
	if event.Kind == "reset" {
		return BuildResetMarkdown(event.Subscription, event.ScheduleType, event.NextResetTime,
			includeKeyword, event.TriggeredAt)
	}
	return BuildLowBalanceMarkdown(event.Subscription, event.Balance, event.Threshold,
		includeKeyword, event.TriggeredAt)
}

// buildMarkdownCard assembles the keyword-aware title and the field list. The
// time line uses the event's own timestamp, never wall clock at send time, so
// the message shows the moment the event happened even under retries.
func buildMarkdownCard(
	sub model.Subscription,
	emoji, longLabel, shortLabel string,
	fields []string,
	includeKeyword bool,
	triggeredAt string,
) (title, body string) {
	if includeKeyword {
		title = fmt.Sprintf("【AI订阅】%s %s %s", emoji, sub.Name, longLabel)
	} else {
		title = fmt.Sprintf("%s %s %s", emoji, sub.Name, shortLabel)
	}
	lines := append([]string{
		"- **订阅**: " + sub.Name,
		"- **提供商**: " + sub.Provider,
	}, fields...)
	lines = append(lines, "- **时间**: "+formatLocalTime(triggeredAt))
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

// BuildWebhookPayload builds the generic webhook body. Low-balance events carry
// balance/threshold; reset events carry scheduleType/nextResetTime. The other
// kind's fields stay absent from the JSON so consumers can rely on the
// discriminator alone.
func BuildWebhookPayload(event Event) WebhookPayload {
	payload := WebhookPayload{
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
	}
	if event.Kind == "low-balance" {
		balance, threshold := event.Balance, event.Threshold
		payload.Balance = &balance
		payload.Threshold = &threshold
	} else {
		payload.ScheduleType = event.ScheduleType
		payload.NextResetTime = event.NextResetTime
	}
	return payload
}

// BuildDingtalkPayload wraps the event markdown in DingTalk's markdown
// envelope.
func BuildDingtalkPayload(event Event, includeKeyword bool) DingtalkPayload {
	var payload DingtalkPayload
	payload.MsgType = "markdown"
	payload.Markdown.Title, payload.Markdown.Text = BuildEventMarkdown(event, includeKeyword)
	return payload
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

// BuildFeishuPayload builds the interactive-card envelope for a feishu webhook
// channel. A channel with a signing secret carries the keyword-free title plus
// top-level timestamp/sign fields; an unsigned channel weaves the keyword into
// the title instead (Feishu keyword security).
func BuildFeishuPayload(event Event, channel model.NotificationChannel, now time.Time) (FeishuPayload, error) {
	title, body := BuildEventMarkdown(event, channel.Secret == "")
	payload := FeishuPayload{MsgType: "interactive", Card: BuildFeishuCard(title, body)}
	if channel.Secret != "" {
		if sign := ComputeFeishuSign(channel.Secret, now.Unix()); sign != nil {
			payload.Timestamp = sign.Timestamp
			payload.Sign = sign.Sign
		}
	}
	return payload, nil
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
		body, err := json.Marshal(BuildDingtalkPayload(event, includeKeyword))
		if err != nil {
			return nil, err
		}
		return &PreparedSend{Channel: channel, URL: BuildDingtalkURL(channel, now), Body: body, Headers: headers}, nil
	case TypeFeishu:
		payload, err := BuildFeishuPayload(event, channel, now)
		if err != nil {
			return nil, err
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
