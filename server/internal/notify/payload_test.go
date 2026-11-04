package notify

// Parity port of __tests__/payload.test.ts (27 cases). The old module built the
// markdown title/body once and wrapped it in the channel-specific envelopes
// (DingTalk markdown, Feishu interactive card, generic webhook JSON). The cases
// below pin the keyword rule (channels without a secret carry 【AI订阅】 in the
// title), the event's own triggeredAt in the footer, the signing fields, and
// the webhook event discriminator with its per-kind optional fields.

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"ai-subscriptions/internal/model"
)

const payloadURL = "https://oapi.dingtalk.com/robot/send?access_token=abc"

func payloadNow() time.Time {
	return time.Date(2024, time.June, 1, 0, 0, 0, 0, time.UTC)
}

func payloadSub(overrides func(*model.Subscription)) model.Subscription {
	balance := 5.0
	sub := model.Subscription{
		ID:               "sub-1",
		Name:             "Claude Pro",
		Category:         "AI助手",
		Provider:         "anthropic",
		SubscriptionType: "one-time",
		Price:            20,
		Status:           "active",
		Balance:          &balance,
		CreatedAt:        "2024-01-01T00:00:00Z",
		UpdatedAt:        "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&sub)
	}
	return sub
}

func payloadChannel(overrides func(*model.NotificationChannel)) model.NotificationChannel {
	channel := model.NotificationChannel{
		ID:        "ch-1",
		Type:      TypeDingtalk,
		Name:      "Test",
		URL:       payloadURL,
		Enabled:   true,
		CreatedAt: "2024-01-01T00:00:00Z",
		UpdatedAt: "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&channel)
	}
	return channel
}

func payloadLowBalanceEvent() Event {
	return Event{
		Kind:         "low-balance",
		Subscription: payloadSub(nil),
		Balance:      5,
		Threshold:    10,
		TriggeredAt:  "2024-06-01T00:00:00Z",
	}
}

func payloadResetEvent() Event {
	return Event{
		Kind:          "reset",
		Subscription:  payloadSub(func(sub *model.Subscription) { sub.Name = "OpenAI Plus" }),
		ScheduleType:  "monthly",
		NextResetTime: "2024-07-01T00:00:00Z",
		TriggeredAt:   "2024-06-01T00:00:00Z",
	}
}

// ---------- buildLowBalanceMarkdown (3 cases) ----------

func TestBuildLowBalanceMarkdownWeavesKeywordIntoTitle(t *testing.T) {
	title, body := BuildLowBalanceMarkdown(payloadSub(nil), 5, 10, true, "2024-06-01T00:00:00Z")
	if !strings.Contains(title, "【AI订阅】") {
		t.Errorf("title = %q, want the keyword", title)
	}
	if !strings.Contains(title, "Claude Pro") {
		t.Errorf("title = %q, want the subscription name", title)
	}
	if strings.Contains(body, "**关键词**") {
		t.Errorf("body = %q, want no separate keyword line", body)
	}
}

func TestBuildLowBalanceMarkdownOmitsKeywordFromTitle(t *testing.T) {
	title, _ := BuildLowBalanceMarkdown(payloadSub(nil), 5, 10, false, "2024-06-01T00:00:00Z")
	if strings.Contains(title, "AI订阅") {
		t.Errorf("title = %q, want no keyword", title)
	}
	if !strings.Contains(title, "余额不足") {
		t.Errorf("title = %q, want 余额不足", title)
	}
}

func TestBuildLowBalanceMarkdownRendersTriggeredAt(t *testing.T) {
	_, body := BuildLowBalanceMarkdown(payloadSub(nil), 5, 10, false, "2024-06-01T12:34:56Z")
	for _, want := range []string{"2024", "6", "1", "34"} {
		if !strings.Contains(body, want) {
			t.Errorf("body = %q, want the event triggeredAt component %q", body, want)
		}
	}
}

// ---------- buildDingtalkPayload (1 case) ----------

func TestBuildDingtalkPayloadRendersMarkdown(t *testing.T) {
	payload := BuildDingtalkPayload(payloadLowBalanceEvent(), false)
	if payload.MsgType != "markdown" {
		t.Errorf("msgtype = %q, want markdown", payload.MsgType)
	}
	if !strings.Contains(payload.Markdown.Title, "Claude Pro") {
		t.Errorf("title = %q, want Claude Pro", payload.Markdown.Title)
	}
	if !strings.Contains(payload.Markdown.Text, "5") || !strings.Contains(payload.Markdown.Text, "10") {
		t.Errorf("text = %q, want balance and threshold", payload.Markdown.Text)
	}
}

// ---------- buildDingtalkUrl (2 cases) ----------

func TestBuildDingtalkURLReturnsRawURLWithoutSecret(t *testing.T) {
	channel := payloadChannel(nil)
	if got := BuildDingtalkURL(channel, payloadNow()); got != channel.URL {
		t.Errorf("BuildDingtalkURL = %q, want %q", got, channel.URL)
	}
}

func TestBuildDingtalkURLAppendsSignedQueryWithSecret(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) { ch.Secret = "mysecret" })
	got := BuildDingtalkURL(channel, payloadNow())
	if !strings.Contains(got, "timestamp=") || !strings.Contains(got, "sign=") {
		t.Errorf("BuildDingtalkURL = %q, want timestamp and sign query params", got)
	}
}

// ---------- prepareSend (6 cases) ----------

func TestPrepareSendRejectsDisabledChannel(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) { ch.Enabled = false })
	if _, err := PrepareSend(channel, payloadLowBalanceEvent(), payloadNow()); err == nil {
		t.Fatal("PrepareSend(disabled channel) = nil error, want an error")
	}
}

func TestPrepareSendKeywordsDingtalkOnlyWithoutSecret(t *testing.T) {
	noSecret := payloadChannel(func(ch *model.NotificationChannel) { ch.ID = "no-secret" })
	withSecret := payloadChannel(func(ch *model.NotificationChannel) {
		ch.ID = "with-secret"
		ch.Secret = "s3cret"
	})

	preparedNoSecret, err := PrepareSend(noSecret, payloadLowBalanceEvent(), payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend(no secret): %v", err)
	}
	preparedWithSecret, err := PrepareSend(withSecret, payloadLowBalanceEvent(), payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend(with secret): %v", err)
	}

	var noSecretBody, withSecretBody DingtalkPayload
	if err := json.Unmarshal(preparedNoSecret.Body, &noSecretBody); err != nil {
		t.Fatalf("decode no-secret body: %v", err)
	}
	if err := json.Unmarshal(preparedWithSecret.Body, &withSecretBody); err != nil {
		t.Fatalf("decode with-secret body: %v", err)
	}
	if !strings.Contains(noSecretBody.Markdown.Title, "AI订阅") {
		t.Errorf("unsigned title = %q, want the keyword", noSecretBody.Markdown.Title)
	}
	if strings.Contains(withSecretBody.Markdown.Title, "AI订阅") {
		t.Errorf("signed title = %q, want no keyword", withSecretBody.Markdown.Title)
	}
}

func TestPrepareSendReturnsJSONBodyWithContentType(t *testing.T) {
	prepared, err := PrepareSend(payloadChannel(nil), payloadLowBalanceEvent(), payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend: %v", err)
	}
	if got := prepared.Headers["Content-Type"]; got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	var body map[string]any
	if err := json.Unmarshal(prepared.Body, &body); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
}

func TestPrepareSendPreparesFeishuCard(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) {
		ch.ID = "feishu-1"
		ch.Type = TypeFeishu
	})
	prepared, err := PrepareSend(channel, payloadLowBalanceEvent(), payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend: %v", err)
	}
	if prepared.URL != channel.URL {
		t.Errorf("url = %q, want %q", prepared.URL, channel.URL)
	}
	if got := prepared.Headers["Content-Type"]; got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	var body FeishuPayload
	if err := json.Unmarshal(prepared.Body, &body); err != nil {
		t.Fatalf("decode Feishu body: %v", err)
	}
	if body.MsgType != "interactive" {
		t.Errorf("msg_type = %q, want interactive", body.MsgType)
	}
	if !strings.Contains(body.Card.Header.Title.Content, "Claude Pro") {
		t.Errorf("title = %q, want Claude Pro", body.Card.Header.Title.Content)
	}
	if len(body.Card.Elements) != 1 || body.Card.Elements[0].Tag != "markdown" {
		t.Fatalf("elements = %#v, want one markdown element", body.Card.Elements)
	}
	if !strings.Contains(body.Card.Elements[0].Content, "5") {
		t.Errorf("card content = %q, want the balance", body.Card.Elements[0].Content)
	}
	if body.Timestamp != "" || body.Sign != "" {
		t.Errorf("timestamp/sign = %q/%q, want none without a secret", body.Timestamp, body.Sign)
	}
	if !strings.Contains(body.Card.Header.Title.Content, "AI订阅") {
		t.Errorf("title = %q, want the keyword without a secret", body.Card.Header.Title.Content)
	}
}

func TestPrepareSendSignsFeishuPayloadWithSecret(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) {
		ch.ID = "feishu-signed"
		ch.Type = TypeFeishu
		ch.Secret = "test-feishu-secret"
	})
	prepared, err := PrepareSend(channel, payloadLowBalanceEvent(), payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend: %v", err)
	}
	var body FeishuPayload
	if err := json.Unmarshal(prepared.Body, &body); err != nil {
		t.Fatalf("decode Feishu body: %v", err)
	}
	if body.MsgType != "interactive" {
		t.Errorf("msg_type = %q, want interactive", body.MsgType)
	}
	if body.Timestamp == "" || body.Sign == "" {
		t.Errorf("timestamp/sign = %q/%q, want both present", body.Timestamp, body.Sign)
	}
	if strings.Contains(body.Card.Header.Title.Content, "AI订阅") {
		t.Errorf("title = %q, want no keyword when signed", body.Card.Header.Title.Content)
	}
}

func TestPrepareSendPreparesWebhookPayload(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) {
		ch.ID = "wh-1"
		ch.Type = TypeWebhook
	})
	prepared, err := PrepareSend(channel, payloadLowBalanceEvent(), payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend: %v", err)
	}
	if prepared.URL != channel.URL {
		t.Errorf("url = %q, want %q", prepared.URL, channel.URL)
	}
	if got := prepared.Headers["Content-Type"]; got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	var body WebhookPayload
	if err := json.Unmarshal(prepared.Body, &body); err != nil {
		t.Fatalf("decode webhook body: %v", err)
	}
	if body.Event != "low-balance" {
		t.Errorf("event = %q, want low-balance", body.Event)
	}
	if body.Subscription.ID != "sub-1" || body.Subscription.Name != "Claude Pro" {
		t.Errorf("subscription = %#v, want sub-1/Claude Pro", body.Subscription)
	}
	if body.Balance == nil || *body.Balance != 5 {
		t.Errorf("balance = %v, want 5", body.Balance)
	}
	if body.Threshold == nil || *body.Threshold != 10 {
		t.Errorf("threshold = %v, want 10", body.Threshold)
	}
	if body.Timestamp != "2024-06-01T00:00:00Z" {
		t.Errorf("timestamp = %q, want the event triggeredAt", body.Timestamp)
	}
}

// ---------- formatScheduleType (1 case) ----------

func TestFormatScheduleTypeMapsLabels(t *testing.T) {
	cases := map[string]string{
		"fiveHour": "每5小时",
		"weekly":   "每周",
		"monthly":  "每月",
	}
	for input, want := range cases {
		if got := FormatScheduleType(input); got != want {
			t.Errorf("FormatScheduleType(%q) = %q, want %q", input, got, want)
		}
	}
}

// ---------- buildResetMarkdown (3 cases) ----------

func TestBuildResetMarkdownIncludesFields(t *testing.T) {
	sub := payloadSub(func(s *model.Subscription) {
		s.Name = "OpenAI Plus"
		s.Provider = "openai"
	})
	title, body := BuildResetMarkdown(sub, "monthly", "2024-07-01T00:00:00Z", false, "2024-06-01T00:00:00Z")
	if !strings.Contains(title, "OpenAI Plus") || !strings.Contains(title, "配额已重置") {
		t.Errorf("title = %q, want name and 配额已重置", title)
	}
	if !strings.Contains(body, "每月") || !strings.Contains(body, "openai") {
		t.Errorf("body = %q, want schedule type and provider", body)
	}
	if !strings.Contains(body, "下次重置") {
		t.Errorf("body = %q, want the next reset label", body)
	}
}

func TestBuildResetMarkdownWeavesKeyword(t *testing.T) {
	sub := payloadSub(func(s *model.Subscription) { s.Name = "OpenAI Plus" })
	title, _ := BuildResetMarkdown(sub, "weekly", "2024-07-01T00:00:00Z", true, "2024-06-01T00:00:00Z")
	if !strings.Contains(title, "【AI订阅】") || !strings.Contains(title, "OpenAI Plus") {
		t.Errorf("title = %q, want keyword and name", title)
	}
}

func TestBuildResetMarkdownOmitsKeyword(t *testing.T) {
	sub := payloadSub(func(s *model.Subscription) { s.Name = "OpenAI Plus" })
	title, _ := BuildResetMarkdown(sub, "weekly", "2024-07-01T00:00:00Z", false, "2024-06-01T00:00:00Z")
	if strings.Contains(title, "AI订阅") {
		t.Errorf("title = %q, want no keyword", title)
	}
}

// ---------- buildEventMarkdown (2 cases) ----------

func TestBuildEventMarkdownDispatchesLowBalance(t *testing.T) {
	title, body := BuildEventMarkdown(payloadLowBalanceEvent(), false)
	if !strings.Contains(title, "余额不足") {
		t.Errorf("title = %q, want 余额不足", title)
	}
	if !strings.Contains(body, "2024") {
		t.Errorf("body = %q, want the event triggeredAt", body)
	}
}

func TestBuildEventMarkdownDispatchesReset(t *testing.T) {
	event := payloadResetEvent()
	event.Subscription.Name = "OpenAI Plus"
	event.TriggeredAt = "2024-06-15T08:30:00Z"
	title, body := BuildEventMarkdown(event, false)
	if !strings.Contains(title, "配额已重置") {
		t.Errorf("title = %q, want 配额已重置", title)
	}
	if !strings.Contains(body, "每月") {
		t.Errorf("body = %q, want 每月", body)
	}
	if !strings.Contains(body, "6") || !strings.Contains(body, "15") {
		t.Errorf("body = %q, want the event triggeredAt components", body)
	}
}

// ---------- buildDingtalkPayload (reset) (1 case) ----------

func TestBuildDingtalkPayloadRendersReset(t *testing.T) {
	payload := BuildDingtalkPayload(payloadResetEvent(), false)
	if payload.MsgType != "markdown" {
		t.Errorf("msgtype = %q, want markdown", payload.MsgType)
	}
	if !strings.Contains(payload.Markdown.Title, "OpenAI Plus") {
		t.Errorf("title = %q, want OpenAI Plus", payload.Markdown.Title)
	}
	if !strings.Contains(payload.Markdown.Text, "每月") {
		t.Errorf("text = %q, want 每月", payload.Markdown.Text)
	}
}

// ---------- prepareSend (reset) (1 case) ----------

func TestPrepareSendPreparesDingtalkReset(t *testing.T) {
	event := payloadResetEvent()
	event.ScheduleType = "weekly"
	prepared, err := PrepareSend(payloadChannel(nil), event, payloadNow())
	if err != nil {
		t.Fatalf("PrepareSend: %v", err)
	}
	if got := prepared.Headers["Content-Type"]; got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	var body DingtalkPayload
	if err := json.Unmarshal(prepared.Body, &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.MsgType != "markdown" {
		t.Errorf("msgtype = %q, want markdown", body.MsgType)
	}
	if !strings.Contains(body.Markdown.Title, "OpenAI Plus") {
		t.Errorf("title = %q, want OpenAI Plus", body.Markdown.Title)
	}
	if !strings.Contains(body.Markdown.Text, "每周") {
		t.Errorf("text = %q, want 每周", body.Markdown.Text)
	}
}

// ---------- buildFeishuPayload (5 cases) ----------

func TestBuildFeishuPayloadBuildsCard(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) { ch.Type = TypeFeishu })
	payload, err := BuildFeishuPayload(payloadLowBalanceEvent(), channel, payloadNow())
	if err != nil {
		t.Fatalf("BuildFeishuPayload: %v", err)
	}
	if payload.MsgType != "interactive" {
		t.Errorf("msg_type = %q, want interactive", payload.MsgType)
	}
	if payload.Card.Header.Title.Tag != "plain_text" {
		t.Errorf("title tag = %q, want plain_text", payload.Card.Header.Title.Tag)
	}
	if !strings.Contains(payload.Card.Header.Title.Content, "Claude Pro") {
		t.Errorf("title = %q, want Claude Pro", payload.Card.Header.Title.Content)
	}
	if len(payload.Card.Elements) != 1 || payload.Card.Elements[0].Tag != "markdown" {
		t.Fatalf("elements = %#v, want one markdown element", payload.Card.Elements)
	}
	if !strings.Contains(payload.Card.Elements[0].Content, "5") || !strings.Contains(payload.Card.Elements[0].Content, "10") {
		t.Errorf("content = %q, want balance and threshold", payload.Card.Elements[0].Content)
	}
}

func TestBuildFeishuPayloadOmitsSignatureWithoutSecret(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) { ch.Type = TypeFeishu })
	payload, err := BuildFeishuPayload(payloadLowBalanceEvent(), channel, payloadNow())
	if err != nil {
		t.Fatalf("BuildFeishuPayload: %v", err)
	}
	if payload.Timestamp != "" || payload.Sign != "" {
		t.Errorf("timestamp/sign = %q/%q, want none", payload.Timestamp, payload.Sign)
	}
}

func TestBuildFeishuPayloadSignsWithSecret(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) {
		ch.Type = TypeFeishu
		ch.Secret = "my-secret"
	})
	payload, err := BuildFeishuPayload(payloadLowBalanceEvent(), channel, payloadNow())
	if err != nil {
		t.Fatalf("BuildFeishuPayload: %v", err)
	}
	if payload.Timestamp == "" || payload.Sign == "" || len(payload.Sign) == 0 {
		t.Errorf("timestamp/sign = %q/%q, want both present", payload.Timestamp, payload.Sign)
	}
}

func TestBuildFeishuPayloadRendersReset(t *testing.T) {
	channel := payloadChannel(func(ch *model.NotificationChannel) { ch.Type = TypeFeishu })
	payload, err := BuildFeishuPayload(payloadResetEvent(), channel, payloadNow())
	if err != nil {
		t.Fatalf("BuildFeishuPayload: %v", err)
	}
	if !strings.Contains(payload.Card.Header.Title.Content, "OpenAI Plus") {
		t.Errorf("title = %q, want OpenAI Plus", payload.Card.Header.Title.Content)
	}
	if !strings.Contains(payload.Card.Header.Title.Content, "配额已重置") {
		t.Errorf("title = %q, want 配额已重置", payload.Card.Header.Title.Content)
	}
	if !strings.Contains(payload.Card.Elements[0].Content, "每月") {
		t.Errorf("content = %q, want 每月", payload.Card.Elements[0].Content)
	}
}

func TestBuildFeishuPayloadKeywordsOnlyWithoutSecret(t *testing.T) {
	noSecret := payloadChannel(func(ch *model.NotificationChannel) {
		ch.ID = "a"
		ch.Type = TypeFeishu
	})
	withSecret := payloadChannel(func(ch *model.NotificationChannel) {
		ch.ID = "b"
		ch.Type = TypeFeishu
		ch.Secret = "s3cret"
	})
	unsigned, err := BuildFeishuPayload(payloadLowBalanceEvent(), noSecret, payloadNow())
	if err != nil {
		t.Fatalf("BuildFeishuPayload(unsigned): %v", err)
	}
	signed, err := BuildFeishuPayload(payloadLowBalanceEvent(), withSecret, payloadNow())
	if err != nil {
		t.Fatalf("BuildFeishuPayload(signed): %v", err)
	}
	if !strings.Contains(unsigned.Card.Header.Title.Content, "AI订阅") {
		t.Errorf("unsigned title = %q, want the keyword", unsigned.Card.Header.Title.Content)
	}
	if strings.Contains(signed.Card.Header.Title.Content, "AI订阅") {
		t.Errorf("signed title = %q, want no keyword", signed.Card.Header.Title.Content)
	}
}

// ---------- buildWebhookPayload (2 cases) ----------

func TestBuildWebhookPayloadIncludesEventAndMetadata(t *testing.T) {
	payload := BuildWebhookPayload(payloadLowBalanceEvent())
	if payload.Event != "low-balance" {
		t.Errorf("event = %q, want low-balance", payload.Event)
	}
	if payload.Timestamp != "2024-06-01T00:00:00Z" {
		t.Errorf("timestamp = %q, want the event triggeredAt", payload.Timestamp)
	}
	want := WebhookSubscription{
		ID:               "sub-1",
		Name:             "Claude Pro",
		Category:         "AI助手",
		Provider:         "anthropic",
		SubscriptionType: "one-time",
		Price:            20,
	}
	if payload.Subscription != want {
		t.Errorf("subscription = %#v, want %#v", payload.Subscription, want)
	}
	if payload.Balance == nil || *payload.Balance != 5 {
		t.Errorf("balance = %v, want 5", payload.Balance)
	}
	if payload.Threshold == nil || *payload.Threshold != 10 {
		t.Errorf("threshold = %v, want 10", payload.Threshold)
	}
	if payload.ScheduleType != "" || payload.NextResetTime != "" {
		t.Errorf("schedule fields = %q/%q, want none on low-balance", payload.ScheduleType, payload.NextResetTime)
	}
}

func TestBuildWebhookPayloadIncludesScheduleFieldsForReset(t *testing.T) {
	event := payloadResetEvent()
	event.ScheduleType = "weekly"
	payload := BuildWebhookPayload(event)
	if payload.Event != "reset" {
		t.Errorf("event = %q, want reset", payload.Event)
	}
	if payload.ScheduleType != "weekly" {
		t.Errorf("scheduleType = %q, want weekly", payload.ScheduleType)
	}
	if payload.NextResetTime != "2024-07-01T00:00:00Z" {
		t.Errorf("nextResetTime = %q, want the event nextResetTime", payload.NextResetTime)
	}
	if payload.Balance != nil || payload.Threshold != nil {
		t.Errorf("balance/threshold = %v/%v, want none on reset", payload.Balance, payload.Threshold)
	}
}

func TestNewHTTPSenderDefaultsToTimeoutClient(t *testing.T) {
	sender := NewHTTPSender(nil)
	if sender.Client == nil || sender.Client.Timeout != 10*time.Second {
		t.Fatalf("default sender must use a 10s-timeout client, got %+v", sender.Client)
	}
}
