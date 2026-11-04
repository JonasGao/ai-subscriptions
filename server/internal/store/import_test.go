package store

// Parity port of __tests__/tags.test.ts case 1 — "migrates existing data with
// an empty tag catalog and associations" — plus the ADR-0017 importer
// guarantees: snapshot before writing, one-way, ciphertext moved verbatim.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/model"
)

func writeJSONFile(t *testing.T, dir, name string, payload any) string {
	t.Helper()
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		t.Fatalf("marshal %s: %v", name, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

// tags.test.ts case 1: legacy documents without a tag catalog import with an
// empty catalog and empty per-subscription associations.
func TestImportLegacyDataWithoutTags(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", map[string]any{
		"subscriptions": []any{map[string]any{
			"id":               "sub-1",
			"name":             "Legacy",
			"category":         "AI助手",
			"provider":         "openai",
			"subscriptionType": "recurring",
			"billingCycle":     "monthly",
			"price":            20,
			"status":           "active",
			"createdAt":        "2024-01-01T00:00:00.000Z",
			"updatedAt":        "2024-01-01T00:00:00.000Z",
		}},
		"categories": []string{"AI助手"},
	})

	s := openStoreIn(t, dir)
	data, err := s.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}

	if len(data.Tags) != 0 {
		t.Fatalf("tags = %#v, want empty", data.Tags)
	}
	if len(data.Subscriptions) != 1 {
		t.Fatalf("subscriptions = %d, want 1", len(data.Subscriptions))
	}
	if len(data.Subscriptions[0].TagIDs) != 0 {
		t.Fatalf("tagIds = %#v, want empty", data.Subscriptions[0].TagIDs)
	}
}

// ADR-0017: ciphertext is carried over byte for byte — no decrypt/re-encrypt.
func TestImportMovesCiphertextVerbatim(t *testing.T) {
	dir := t.TempDir()
	const credentials = "v1:0f0e0d0c0b0a090807060504030201ff:0b62604c994626abd106ffb0567117d94730a543f9835ef361d399eb580a31a1fed1c5a5e73dbc7b18433cb6ae692ab140bd158cf4f39235e443fe0c66f5e651"
	const legacyAPIKey = "000102030405060708090a0b0c0d0e0f:6bacf7368db7cf210059a452342a6d2284f6e0bb2acb6331dea3d6fbc8828433"
	writeJSONFile(t, dir, "subscriptions.json", map[string]any{
		"subscriptions": []any{
			map[string]any{
				"id": "sub-creds", "name": "Has credentials", "category": "官方订阅",
				"provider": "alibaba", "subscriptionType": "recurring",
				"billingCycle": "monthly", "price": 680, "status": "active",
				"credentials": credentials,
				"createdAt":   "2026-08-02T07:19:46.302Z",
				"updatedAt":   "2026-10-23T09:00:01.552Z",
				"planId":      "token-plan",
			},
			map[string]any{
				"id": "sub-legacy-key", "name": "Legacy apiKey", "category": "官方订阅",
				"provider": "openai", "subscriptionType": "recurring",
				"billingCycle": "monthly", "price": 20, "status": "active",
				"apiKey":    legacyAPIKey,
				"createdAt": "2026-08-02T07:19:46.302Z",
				"updatedAt": "2026-10-23T09:00:01.552Z",
			},
		},
		"categories": []string{"官方订阅"},
		"tags":       []any{},
	})

	cipher := crypto.New("interop-secret-42")
	s, err := Open(filepath.Join(dir, "app.db"), WithCipher(cipher))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	subs, err := s.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("subscriptions = %d, want 2", len(subs))
	}
	if subs[0].Credentials != credentials {
		t.Fatalf("credentials = %q, want the original ciphertext", subs[0].Credentials)
	}
	// The retired "apiKey" field follows the old stack's readData rule: its
	// plaintext is moved into a fresh credentials blob. The credentials blob
	// itself is never re-encrypted.
	creds := cipher.DecryptCredentials(subs[1].Credentials)
	if creds["apiKey"] != "sk-test-abcdef1234567890" {
		t.Fatalf("migrated apiKey credentials = %#v", creds)
	}
}

// The retired "AI助手" category is renamed in the catalogue *and* in every
// subscription that referenced it (readData did both); leaving the references
// behind would dangle, and the one-way import + completion marker would freeze
// them forever — the restore-from-JSON-snapshot path included.
func TestImportRenamesRetiredCategoryEverywhere(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", map[string]any{
		"subscriptions": []any{
			map[string]any{
				"id": "sub-retired", "name": "On the retired category", "category": "AI助手",
				"provider": "openai", "subscriptionType": "recurring",
				"billingCycle": "monthly", "price": 20, "status": "active",
				"createdAt": "2024-01-01T00:00:00.000Z",
				"updatedAt": "2024-01-01T00:00:00.000Z",
			},
			map[string]any{
				"id": "sub-current", "name": "Already renamed", "category": "官方订阅",
				"provider": "openai", "subscriptionType": "recurring",
				"billingCycle": "monthly", "price": 20, "status": "active",
				"createdAt": "2024-01-02T00:00:00.000Z",
				"updatedAt": "2024-01-02T00:00:00.000Z",
			},
			map[string]any{
				"id": "sub-other", "name": "Untouched category", "category": "中转站",
				"provider": "openai", "subscriptionType": "recurring",
				"billingCycle": "monthly", "price": 20, "status": "active",
				"createdAt": "2024-01-03T00:00:00.000Z",
				"updatedAt": "2024-01-03T00:00:00.000Z",
			},
		},
		"categories": []string{"AI助手", "官方订阅", "中转站"},
	})

	s := openStoreIn(t, dir)
	data, err := s.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}

	want := []string{"官方订阅", "中转站"}
	if len(data.Categories) != len(want) {
		t.Fatalf("categories = %#v, want %#v", data.Categories, want)
	}
	for i := range want {
		if data.Categories[i] != want[i] {
			t.Fatalf("categories = %#v, want %#v", data.Categories, want)
		}
	}

	known := make(map[string]struct{}, len(data.Categories))
	for _, category := range data.Categories {
		known[category] = struct{}{}
	}
	wantByID := map[string]string{
		"sub-retired": "官方订阅",
		"sub-current": "官方订阅",
		"sub-other":   "中转站",
	}
	if len(data.Subscriptions) != len(wantByID) {
		t.Fatalf("subscriptions = %d, want %d", len(data.Subscriptions), len(wantByID))
	}
	for _, sub := range data.Subscriptions {
		if sub.Category != wantByID[sub.ID] {
			t.Fatalf("subscription %q category = %q, want %q", sub.ID, sub.Category, wantByID[sub.ID])
		}
		if _, ok := known[sub.Category]; !ok {
			t.Fatalf("subscription %q category %q is not in the catalogue %#v", sub.ID, sub.Category, data.Categories)
		}
	}
}

// Disaster recovery per ADR-0017: the pre-import JSON snapshot is the last
// resort, so restoring it into a fresh DATA_DIR must produce a correct import —
// including renamed per-subscription categories.
func TestImportFromRestoredSnapshotRenamesCategories(t *testing.T) {
	origin := t.TempDir()
	writeJSONFile(t, origin, "subscriptions.json", map[string]any{
		"subscriptions": []any{map[string]any{
			"id": "sub-1", "name": "Restored", "category": "AI助手",
			"provider": "openai", "subscriptionType": "recurring",
			"billingCycle": "monthly", "price": 20, "status": "active",
			"createdAt": "2024-01-01T00:00:00.000Z",
			"updatedAt": "2024-01-01T00:00:00.000Z",
		}},
		"categories": []string{"AI助手"},
	})

	first := openStoreIn(t, origin)
	snapshot := first.LegacySnapshotPath()
	if snapshot == "" {
		t.Fatal("no legacy JSON snapshot was taken before import")
	}
	snapshotted, err := os.ReadFile(snapshot)
	if err != nil {
		t.Fatalf("read legacy snapshot: %v", err)
	}

	// Restore the snapshot as the live document of a brand-new data directory.
	restored := t.TempDir()
	if err := os.WriteFile(filepath.Join(restored, "subscriptions.json"), snapshotted, 0o644); err != nil {
		t.Fatalf("restore snapshot: %v", err)
	}

	second := openStoreIn(t, restored)
	data, err := second.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}
	if len(data.Categories) != 1 || data.Categories[0] != "官方订阅" {
		t.Fatalf("categories = %#v, want [官方订阅]", data.Categories)
	}
	if len(data.Subscriptions) != 1 || data.Subscriptions[0].Category != "官方订阅" {
		t.Fatalf("subscriptions = %#v, want category 官方订阅", data.Subscriptions)
	}
}

// ADR-0017: the pre-import JSON snapshot exists and is never modified by later
// writes; the import runs once and is idempotent afterwards.
func TestImportSnapshotsJSONAndRunsOnce(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", map[string]any{
		"subscriptions": []any{map[string]any{
			"id": "sub-1", "name": "Imported", "category": "官方订阅",
			"provider": "openai", "subscriptionType": "recurring",
			"billingCycle": "monthly", "price": 20, "status": "active",
			"createdAt": "2024-01-01T00:00:00.000Z",
			"updatedAt": "2024-01-01T00:00:00.000Z",
		}},
		"categories": []string{"官方订阅"},
	})

	s := openStoreIn(t, dir)
	snapshot := s.LegacySnapshotPath()
	if snapshot == "" {
		t.Fatal("no legacy JSON snapshot was taken before import")
	}
	raw, err := os.ReadFile(snapshot)
	if err != nil {
		t.Fatalf("read legacy snapshot: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("legacy snapshot is empty")
	}
	if filepath.Dir(snapshot) != dir {
		t.Fatalf("legacy snapshot dir = %q, want %q", filepath.Dir(snapshot), dir)
	}

	// Reopening must not re-import (and must not clobber a user edit).
	subs := mustSubscriptions(t, s)
	subs[0].Name = "Renamed after import"
	if err := s.WriteSubscriptionData(&model.SubscriptionData{
		Subscriptions: subs,
		Categories:    []string{"官方订阅"},
		Tags:          []model.Tag{},
	}); err != nil {
		t.Fatalf("WriteSubscriptionData: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	reopened := openStoreIn(t, dir)
	after, err := reopened.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions after reopen: %v", err)
	}
	if len(after) != 1 || after[0].Name != "Renamed after import" {
		t.Fatalf("subscriptions after reopen = %#v, want the edited row", after)
	}
}

// The importer needs the cipher ready: tags, schedules, and every secondary
// document must survive the round trip.
func TestImportCarriesEveryDocument(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", map[string]any{
		"subscriptions": []any{map[string]any{
			"id": "sub-1", "name": "Full", "category": "官方订阅",
			"provider": "alibaba", "providerCustom": "", "subscriptionType": "recurring",
			"billingCycle": "monthly", "price": 680, "status": "active",
			"startDate": "2026-01-01", "renewalDate": "2027-01-01", "notes": "n",
			"planId": "token-plan", "tagIds": []string{"tag-1"},
			"resetSchedules": []any{map[string]any{
				"id": "sched-1", "type": "monthly", "enabled": true,
				"timeOfDay": "17:00", "timezone": "Asia/Shanghai", "dayOfMonth": 23,
				"exhausted": false, "nextResetTime": "2026-11-23T09:00:00.000Z",
				"createdAt": "2026-08-03T02:27:11.253Z", "updatedAt": "2026-10-23T09:00:01.552Z",
			}},
			"createdAt": "2026-08-02T07:19:46.302Z", "updatedAt": "2026-10-23T09:00:01.552Z",
		}},
		"categories": []string{"官方订阅", "中转站"},
		"tags": []any{map[string]any{
			"id": "tag-1", "name": "👎太贵",
			"createdAt": "2026-08-28T04:52:51.950Z", "updatedAt": "2026-08-28T04:52:51.950Z",
		}},
	})
	writeJSONFile(t, dir, "priorities.json", map[string]any{
		"scenes": []any{map[string]any{
			"id": "scene-1", "name": "常规编码", "subscriptionOrder": []string{"sub-1"},
			"createdAt": "2026-05-20T04:47:30.695Z", "updatedAt": "2026-10-07T12:42:57.732Z",
		}},
	})
	writeJSONFile(t, dir, "tools.json", map[string]any{
		"tools": []any{map[string]any{
			"id": "tool-1", "name": "Claude Code", "category": "AI助手",
			"provider": "anthropic", "forms": []string{"CLI / TUI"}, "order": 0,
			"isOpenSource": false, "repoUrl": "", "status": "active", "notes": "",
			"createdAt": "2026-05-21T03:10:08.822Z", "updatedAt": "2026-05-21T06:57:20.631Z",
		}},
	})
	writeJSONFile(t, dir, "tool-priorities.json", map[string]any{
		"scenes": []any{map[string]any{
			"id": "tool-scene-1", "name": "常规开发", "toolOrder": []string{"tool-1"},
			"createdAt": "2026-05-27T08:47:04.249Z", "updatedAt": "2026-08-15T01:20:18.361Z",
		}},
	})
	writeJSONFile(t, dir, "proxy-subscriptions.json", map[string]any{
		"subscriptions": []any{map[string]any{
			"id": "proxy-1", "name": "魔戒.net", "monthlyPrice": 0,
			"website": "https://mojie.app/", "notes": "notes", "status": "in-use",
			"tagIds":    []string{"proxy-tag-1"},
			"createdAt": "2026-08-30T05:59:59.001Z", "updatedAt": "2026-10-27T05:12:35.847Z",
		}},
		"tags": []any{map[string]any{
			"id": "proxy-tag-1", "name": "已注册",
			"createdAt": "2026-08-30T06:02:31.282Z", "updatedAt": "2026-08-30T06:02:31.282Z",
		}},
	})
	writeJSONFile(t, dir, "notifications.json", map[string]any{
		"channels": []any{map[string]any{
			"id": "chan-1", "type": "feishu-app", "name": "飞书测试1",
			"appId": "cli_x", "appSecret": "secret", "receiveId": "ou_x",
			"receiveIdType": "open_id", "enabled": true,
			"lastSendResult": map[string]any{"success": true, "timestamp": "2026-11-04T06:55:01.239Z"},
			"createdAt":      "2026-08-05T06:45:05.198Z", "updatedAt": "2026-08-05T06:45:05.198Z",
		}},
		"defaultLowBalanceThreshold": 10,
		"balanceTransitionStates": map[string]any{
			"sub-x": map[string]any{"status": "below", "updatedAt": "2026-08-28T09:30:00.028Z"},
		},
	})
	writeJSONFile(t, dir, "auth.json", map[string]any{
		"username": "admin", "passwordHash": "$2b$10$hash", "isInitial": false,
		"createdAt": "2026-06-04T09:19:55.123Z", "updatedAt": "2026-06-04T09:20:17.807Z",
	})
	writeJSONFile(t, dir, "last-monthly-reset.json", map[string]any{"lastReset": "2026-11-01T00:00:00.000Z"})

	s := openStoreIn(t, dir)

	data, err := s.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}
	if len(data.Categories) != 2 || data.Categories[0] != "官方订阅" {
		t.Fatalf("categories = %#v", data.Categories)
	}
	if len(data.Tags) != 1 || data.Tags[0].Name != "👎太贵" {
		t.Fatalf("tags = %#v", data.Tags)
	}
	sub := data.Subscriptions[0]
	if len(sub.TagIDs) != 1 || sub.TagIDs[0] != "tag-1" {
		t.Fatalf("tagIds = %#v", sub.TagIDs)
	}
	if len(sub.ResetSchedules) != 1 {
		t.Fatalf("resetSchedules = %#v", sub.ResetSchedules)
	}
	schedule := sub.ResetSchedules[0]
	if schedule.Timezone != "Asia/Shanghai" || schedule.DayOfMonth == nil || *schedule.DayOfMonth != 23 {
		t.Fatalf("schedule = %#v", schedule)
	}
	if sub.StartDate != "2026-01-01" || sub.PlanID != "token-plan" {
		t.Fatalf("subscription = %#v", sub)
	}

	priorities, err := s.PriorityData()
	if err != nil {
		t.Fatalf("PriorityData: %v", err)
	}
	if len(priorities.Scenes) != 1 || priorities.Scenes[0].SubscriptionOrder[0] != "sub-1" {
		t.Fatalf("priorities = %#v", priorities)
	}

	tools, err := s.ToolData()
	if err != nil {
		t.Fatalf("ToolData: %v", err)
	}
	if len(tools.Tools) != 1 || tools.Tools[0].Forms[0] != "CLI / TUI" {
		t.Fatalf("tools = %#v", tools)
	}

	toolPriorities, err := s.ToolPriorityData()
	if err != nil {
		t.Fatalf("ToolPriorityData: %v", err)
	}
	if len(toolPriorities.Scenes) != 1 || toolPriorities.Scenes[0].ToolOrder[0] != "tool-1" {
		t.Fatalf("tool priorities = %#v", toolPriorities)
	}

	proxy, err := s.ProxySubscriptionData()
	if err != nil {
		t.Fatalf("ProxySubscriptionData: %v", err)
	}
	if len(proxy.Subscriptions) != 1 || proxy.Subscriptions[0].Status != "in-use" {
		t.Fatalf("proxy subscriptions = %#v", proxy)
	}
	if len(proxy.Tags) != 1 || proxy.Tags[0].Name != "已注册" {
		t.Fatalf("proxy tags = %#v", proxy.Tags)
	}

	notifications, err := s.NotificationData()
	if err != nil {
		t.Fatalf("NotificationData: %v", err)
	}
	if len(notifications.Channels) != 1 || notifications.Channels[0].Type != "feishu-app" {
		t.Fatalf("channels = %#v", notifications.Channels)
	}
	if notifications.DefaultLowBalanceThreshold != 10 {
		t.Fatalf("threshold = %v, want 10", notifications.DefaultLowBalanceThreshold)
	}
	if state, ok := notifications.BalanceTransitionStates["sub-x"]; !ok || state.Status != "below" {
		t.Fatalf("transition states = %#v", notifications.BalanceTransitionStates)
	}

	auth, err := s.AuthData()
	if err != nil {
		t.Fatalf("AuthData: %v", err)
	}
	if auth == nil || auth.Username != "admin" || auth.PasswordHash != "$2b$10$hash" {
		t.Fatalf("auth = %#v", auth)
	}
	if auth.IsInitial {
		t.Fatal("isInitial was not carried over")
	}

	state, err := s.AppState("last-monthly-reset")
	if err != nil {
		t.Fatalf("AppState: %v", err)
	}
	if state == "" {
		t.Fatal("last-monthly-reset was not imported")
	}
}

// Absent documents import as empty defaults instead of failing.
func TestImportWithOnlySomeDocuments(t *testing.T) {
	dir := t.TempDir()
	s := openStoreIn(t, dir)

	priorities, err := s.PriorityData()
	if err != nil {
		t.Fatalf("PriorityData: %v", err)
	}
	if len(priorities.Scenes) != 0 {
		t.Fatalf("scenes = %#v, want none", priorities.Scenes)
	}
	notifications, err := s.NotificationData()
	if err != nil {
		t.Fatalf("NotificationData: %v", err)
	}
	if len(notifications.Channels) != 0 || notifications.DefaultLowBalanceThreshold != model.DefaultLowBalanceThreshold {
		t.Fatalf("notifications = %#v", notifications)
	}
	if state, err := s.AppState("last-monthly-reset"); err != nil || state != "" {
		t.Fatalf("AppState = %q, %v", state, err)
	}
}
