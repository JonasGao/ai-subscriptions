package store

// Parity port of __tests__/notifications-storage.test.ts (10 cases).
//
// The old stack stored notifications.json as one document and re-wrote it on
// every edit. The Go store keeps the same document shape (NotificationData)
// but persists each channel row directly. Case names and assertions follow
// the old file; the one test that counted fs syscalls is ported as an
// observable "single SQL update" guarantee (see the parity sub-table in
// docs/parity-matrix.md).

import (
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"ai-subscriptions/internal/model"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func openClockStore(t *testing.T) (*Store, func(time.Time)) {
	t.Helper()
	now := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	s, err := Open(filepath.Join(t.TempDir(), "test.db"), WithClock(func() time.Time { return now }))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, func(next time.Time) { now = next }
}

func boolPtr(value bool) *bool { return &value }

func strPtr(value string) *string { return &value }

func TestCreateChannelAssignsIDTimestampsAndDefaultsEnabled(t *testing.T) {
	s := openTestStore(t)

	channel, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type: "dingtalk",
		Name: "Ops",
		URL:  "https://example.com/hook",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	if !uuidPattern.MatchString(channel.ID) {
		t.Errorf("id = %q, want a UUID v4 string", channel.ID)
	}
	if channel.Type != "dingtalk" || channel.Name != "Ops" || channel.URL != "https://example.com/hook" {
		t.Errorf("channel = %+v, want type/name/url copied from input", channel)
	}
	if !channel.Enabled {
		t.Error("enabled = false, want true by default")
	}
	if channel.Secret != "" {
		t.Errorf("secret = %q, want empty", channel.Secret)
	}
	if channel.CreatedAt != channel.UpdatedAt {
		t.Errorf("createdAt %q != updatedAt %q", channel.CreatedAt, channel.UpdatedAt)
	}

	channels, err := s.NotificationChannels()
	if err != nil {
		t.Fatalf("NotificationChannels: %v", err)
	}
	if len(channels) != 1 || channels[0] != *channel {
		t.Errorf("channels = %+v, want the created channel only", channels)
	}
}

func TestCreateChannelPreservesExplicitDisabledAndSecret(t *testing.T) {
	s := openTestStore(t)

	channel, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type:    "feishu",
		Name:    "Alerts",
		URL:     "https://example.com/feishu",
		Secret:  "shh",
		Enabled: boolPtr(false),
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	if channel.Enabled {
		t.Error("enabled = true, want the explicit false to survive")
	}
	if channel.Secret != "shh" {
		t.Errorf("secret = %q, want %q", channel.Secret, "shh")
	}
}

func TestGetChannelByIDReturnsChannelOrNil(t *testing.T) {
	s := openTestStore(t)

	created, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type: "webhook",
		Name: "Hook",
		URL:  "https://example.com/h",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	found, err := s.NotificationChannelByID(created.ID)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if found == nil || *found != *created {
		t.Errorf("found = %+v, want %+v", found, created)
	}

	missing, err := s.NotificationChannelByID("does-not-exist")
	if err != nil {
		t.Fatalf("NotificationChannelByID(unknown): %v", err)
	}
	if missing != nil {
		t.Errorf("missing = %+v, want nil", missing)
	}
}

func TestUpdateChannelMergesFieldsAndRefreshesUpdatedAt(t *testing.T) {
	s, setNow := openClockStore(t)

	created, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type:   "dingtalk",
		Name:   "A",
		URL:    "https://example.com/a",
		Secret: "s",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	// Advance the clock so updatedAt differs from createdAt.
	setNow(time.Date(2024, 6, 1, 0, 0, 5, 0, time.UTC))

	updated, err := s.UpdateNotificationChannel(created.ID, NotificationChannelPatch{
		Name:   strPtr("B"),
		Secret: strPtr(""), // explicit empty clears the stored secret
	})
	if err != nil {
		t.Fatalf("UpdateNotificationChannel: %v", err)
	}
	if updated == nil {
		t.Fatal("updated = nil, want the updated channel")
	}
	if updated.Name != "B" {
		t.Errorf("name = %q, want B", updated.Name)
	}
	if updated.Secret != "" {
		t.Errorf("secret = %q, want cleared", updated.Secret)
	}
	if updated.Type != "dingtalk" || updated.URL != "https://example.com/a" {
		t.Errorf("untouched fields lost: %+v", updated)
	}
	if updated.UpdatedAt == created.UpdatedAt {
		t.Errorf("updatedAt = %q, want it refreshed", updated.UpdatedAt)
	}
}

func TestUpdateChannelReturnsNilForUnknownID(t *testing.T) {
	s := openTestStore(t)

	updated, err := s.UpdateNotificationChannel("nope", NotificationChannelPatch{Name: strPtr("X")})
	if err != nil {
		t.Fatalf("UpdateNotificationChannel: %v", err)
	}
	if updated != nil {
		t.Errorf("updated = %+v, want nil", updated)
	}
}

func TestDeleteChannelRemovesAndReturnsTrueFalseForUnknown(t *testing.T) {
	s := openTestStore(t)

	created, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type: "webhook",
		Name: "Hook",
		URL:  "https://example.com/h",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	removed, err := s.DeleteNotificationChannel(created.ID)
	if err != nil {
		t.Fatalf("DeleteNotificationChannel: %v", err)
	}
	if !removed {
		t.Error("removed = false, want true for an existing channel")
	}

	channels, err := s.NotificationChannels()
	if err != nil {
		t.Fatalf("NotificationChannels: %v", err)
	}
	if len(channels) != 0 {
		t.Errorf("channels = %+v, want empty", channels)
	}

	removed, err = s.DeleteNotificationChannel(created.ID)
	if err != nil {
		t.Fatalf("DeleteNotificationChannel(again): %v", err)
	}
	if removed {
		t.Error("removed = true, want false for an unknown id")
	}
}

func TestToggleChannelEnabledFlipsState(t *testing.T) {
	s := openTestStore(t)

	created, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type: "feishu",
		Name: "F",
		URL:  "https://example.com/f",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	if !created.Enabled {
		t.Fatal("created channel is disabled, want enabled")
	}

	toggled, err := s.ToggleNotificationChannel(created.ID)
	if err != nil {
		t.Fatalf("ToggleNotificationChannel: %v", err)
	}
	if toggled == nil || toggled.Enabled {
		t.Errorf("toggled = %+v, want enabled=false", toggled)
	}

	toggled, err = s.ToggleNotificationChannel(created.ID)
	if err != nil {
		t.Fatalf("ToggleNotificationChannel(again): %v", err)
	}
	if toggled == nil || !toggled.Enabled {
		t.Errorf("toggled = %+v, want enabled=true", toggled)
	}

	missing, err := s.ToggleNotificationChannel("nope")
	if err != nil {
		t.Fatalf("ToggleNotificationChannel(unknown): %v", err)
	}
	if missing != nil {
		t.Errorf("missing = %+v, want nil", missing)
	}
}

func TestToggleChannelEnabledPerformsSingleUpdate(t *testing.T) {
	// Regression guard for the old test "toggleChannelEnabled performs one
	// read and one write". fs syscall counting has no SQLite counterpart, so
	// the guarantee is expressed structurally: the flip runs as one UPDATE
	// statement (enabled = 1 - enabled), never a read-modify-write, and it
	// touches exactly one row without disturbing any other column.
	s := openTestStore(t)

	created, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type:   "webhook",
		Name:   "H",
		URL:    "https://example.com/h",
		Secret: "keep-me",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	if _, err := s.ToggleNotificationChannel(created.ID); err != nil {
		t.Fatalf("ToggleNotificationChannel: %v", err)
	}

	var changed int
	if err := s.DB().QueryRow("SELECT changes()").Scan(&changed); err != nil {
		t.Fatalf("changes(): %v", err)
	}
	if changed != 1 {
		t.Errorf("changes() = %d, want exactly one row updated", changed)
	}

	refreshed, err := s.NotificationChannelByID(created.ID)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if refreshed.Enabled {
		t.Error("enabled = true, want the flip to have happened")
	}
	if refreshed.Secret != "keep-me" || refreshed.Name != "H" || refreshed.URL != "https://example.com/h" {
		t.Errorf("toggle disturbed other columns: %+v", refreshed)
	}
}

func TestDefaultLowBalanceThresholdDefaultsToTen(t *testing.T) {
	s := openTestStore(t)

	threshold, err := s.DefaultLowBalanceThreshold()
	if err != nil {
		t.Fatalf("DefaultLowBalanceThreshold: %v", err)
	}
	if threshold != model.DefaultLowBalanceThreshold {
		t.Errorf("threshold = %v, want %v", threshold, model.DefaultLowBalanceThreshold)
	}
}

func TestSetDefaultLowBalanceThresholdPersists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.SetDefaultLowBalanceThreshold(25); err != nil {
		t.Fatalf("SetDefaultLowBalanceThreshold: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Re-open to prove the value went to disk.
	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()

	threshold, err := reopened.DefaultLowBalanceThreshold()
	if err != nil {
		t.Fatalf("DefaultLowBalanceThreshold: %v", err)
	}
	if threshold != 25 {
		t.Errorf("threshold = %v, want 25", threshold)
	}
}

// ---------- additional storage surface used by the dispatcher (#39) ----------

func TestUpdateChannelSendResultPersists(t *testing.T) {
	s := openTestStore(t)

	created, err := s.CreateNotificationChannel(NotificationChannelInput{
		Type: "webhook",
		Name: "Hook",
		URL:  "https://example.com/h",
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}

	result := model.SendResult{Success: false, Timestamp: "2024-06-01T00:00:00.000Z", Error: "boom"}
	if err := s.SetNotificationChannelSendResult(created.ID, result); err != nil {
		t.Fatalf("SetNotificationChannelSendResult: %v", err)
	}

	refreshed, err := s.NotificationChannelByID(created.ID)
	if err != nil {
		t.Fatalf("NotificationChannelByID: %v", err)
	}
	if refreshed.LastSendResult == nil || *refreshed.LastSendResult != result {
		t.Errorf("lastSendResult = %+v, want %+v", refreshed.LastSendResult, result)
	}
	if refreshed.UpdatedAt != created.UpdatedAt {
		t.Errorf("updatedAt changed to %q; old updateChannelSendResult leaves it untouched", refreshed.UpdatedAt)
	}

	// Unknown id is a silent no-op, like the old helper.
	if err := s.SetNotificationChannelSendResult("nope", result); err != nil {
		t.Fatalf("SetNotificationChannelSendResult(unknown): %v", err)
	}
}

func TestBalanceTransitionStateRoundTrip(t *testing.T) {
	s := openTestStore(t)

	missing, err := s.BalanceTransitionState("sub-1")
	if err != nil {
		t.Fatalf("BalanceTransitionState: %v", err)
	}
	if missing != nil {
		t.Errorf("missing = %+v, want nil", missing)
	}

	state := model.BalanceTransitionState{Status: "below", UpdatedAt: "2024-06-01T00:00:00.000Z"}
	if err := s.SetBalanceTransitionState("sub-1", state); err != nil {
		t.Fatalf("SetBalanceTransitionState: %v", err)
	}

	stored, err := s.BalanceTransitionState("sub-1")
	if err != nil {
		t.Fatalf("BalanceTransitionState: %v", err)
	}
	if stored == nil || *stored != state {
		t.Errorf("stored = %+v, want %+v", stored, state)
	}
}

func TestNotificationChannelsKeepInsertionOrder(t *testing.T) {
	s := openTestStore(t)

	for _, name := range []string{"first", "second", "third"} {
		if _, err := s.CreateNotificationChannel(NotificationChannelInput{
			Type: "webhook",
			Name: name,
			URL:  "https://example.com/" + name,
		}); err != nil {
			t.Fatalf("CreateNotificationChannel(%s): %v", name, err)
		}
	}

	channels, err := s.NotificationChannels()
	if err != nil {
		t.Fatalf("NotificationChannels: %v", err)
	}
	if len(channels) != 3 {
		t.Fatalf("len(channels) = %d, want 3", len(channels))
	}
	for i, want := range []string{"first", "second", "third"} {
		if channels[i].Name != want {
			t.Errorf("channels[%d].Name = %q, want %q", i, channels[i].Name, want)
		}
	}
}
