package notify

// Parity port of __tests__/feishu-credentials.test.ts (8 cases). The old
// resolver turned a request body into appId/appSecret either directly or by
// reading an already-saved channel; the cases below keep the resolution order
// and the exact Chinese error strings the settings page shows.

import (
	"strings"
	"testing"

	"ai-subscriptions/internal/model"
)

func feishuAppChannelFixture() *model.NotificationChannel {
	return &model.NotificationChannel{
		ID:            "ch-1",
		Type:          TypeFeishuApp,
		Name:          "Test",
		AppID:         "stored-app-id",
		AppSecret:     "stored-app-secret",
		ReceiveID:     "ou_xxx",
		ReceiveIDType: "open_id",
		Enabled:       true,
	}
}

func TestResolveFeishuCredentialsUsesDirectBody(t *testing.T) {
	called := false
	creds, err := ResolveFeishuCredentials(
		map[string]any{"appId": "direct-app-id", "appSecret": "direct-app-secret"},
		func(string) (*model.NotificationChannel, error) {
			called = true
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("ResolveFeishuCredentials: %v", err)
	}
	if creds.AppID != "direct-app-id" || creds.AppSecret != "direct-app-secret" {
		t.Errorf("creds = %+v, want the body credentials", creds)
	}
	if called {
		t.Error("channel lookup was called, want direct credentials to win")
	}
}

func TestResolveFeishuCredentialsUsesStoredChannel(t *testing.T) {
	creds, err := ResolveFeishuCredentials(
		map[string]any{"channelId": "ch-1"},
		func(id string) (*model.NotificationChannel, error) {
			if id != "ch-1" {
				t.Fatalf("lookup id = %q, want ch-1", id)
			}
			return feishuAppChannelFixture(), nil
		},
	)
	if err != nil {
		t.Fatalf("ResolveFeishuCredentials: %v", err)
	}
	if creds.AppID != "stored-app-id" || creds.AppSecret != "stored-app-secret" {
		t.Errorf("creds = %+v, want the stored credentials", creds)
	}
}

func TestResolveFeishuCredentialsUsesBodyAppIDWithStoredSecret(t *testing.T) {
	creds, err := ResolveFeishuCredentials(
		map[string]any{"channelId": "ch-1", "appId": "new-app-id"},
		func(string) (*model.NotificationChannel, error) { return feishuAppChannelFixture(), nil },
	)
	if err != nil {
		t.Fatalf("ResolveFeishuCredentials: %v", err)
	}
	if creds.AppID != "new-app-id" || creds.AppSecret != "stored-app-secret" {
		t.Errorf("creds = %+v, want body appId with stored secret", creds)
	}
}

func TestResolveFeishuCredentialsRequiresAppIDAndSecretOrChannelID(t *testing.T) {
	_, err := ResolveFeishuCredentials(
		map[string]any{"appId": "app-id"},
		func(string) (*model.NotificationChannel, error) {
			t.Fatal("lookup must not be called without a channelId")
			return nil, nil
		},
	)
	if err == nil || !strings.Contains(err.Error(), "请提供 appId 和 appSecret") {
		t.Fatalf("err = %v, want the direct-credentials hint", err)
	}
}

func TestResolveFeishuCredentialsRejectsUnknownChannel(t *testing.T) {
	_, err := ResolveFeishuCredentials(
		map[string]any{"channelId": "nonexistent"},
		func(string) (*model.NotificationChannel, error) { return nil, nil },
	)
	if err == nil || !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("err = %v, want channel-not-found", err)
	}
}

func TestResolveFeishuCredentialsRejectsNonFeishuAppChannel(t *testing.T) {
	_, err := ResolveFeishuCredentials(
		map[string]any{"channelId": "ch-2"},
		func(string) (*model.NotificationChannel, error) {
			return &model.NotificationChannel{ID: "ch-2", Type: TypeWebhook, Name: "Webhook", URL: "https://example.com", Enabled: true}, nil
		},
	)
	if err == nil || !strings.Contains(err.Error(), "不是 feishu-app") {
		t.Fatalf("err = %v, want the wrong-type message", err)
	}
}

func TestResolveFeishuCredentialsRejectsStoredChannelWithoutAppSecret(t *testing.T) {
	_, err := ResolveFeishuCredentials(
		map[string]any{"channelId": "ch-3"},
		func(string) (*model.NotificationChannel, error) {
			return &model.NotificationChannel{ID: "ch-3", Type: TypeFeishuApp, Name: "Test", AppID: "app-id"}, nil
		},
	)
	if err == nil || !strings.Contains(err.Error(), "没有已存储的 appSecret") {
		t.Fatalf("err = %v, want the missing-secret message", err)
	}
}

func TestResolveFeishuCredentialsTrimsWhitespace(t *testing.T) {
	creds, err := ResolveFeishuCredentials(
		map[string]any{"appId": "  app-id  ", "appSecret": "  app-secret  "},
		nil,
	)
	if err != nil {
		t.Fatalf("ResolveFeishuCredentials: %v", err)
	}
	if creds.AppID != "app-id" || creds.AppSecret != "app-secret" {
		t.Errorf("creds = %+v, want trimmed values", creds)
	}
}
