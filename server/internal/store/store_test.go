package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestOpenEnablesWAL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wal.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	var mode string
	if err := s.db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("PRAGMA journal_mode: %v", err)
	}
	if strings.ToLower(mode) != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}

	// WAL is a persistent database property: reopening keeps it.
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	if err := s2.db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("pragma after reopen: %v", err)
	}
	if strings.ToLower(mode) != "wal" {
		t.Fatalf("journal_mode after reopen = %q, want wal", mode)
	}
}

func TestOpenMigratesUserVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "version.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	if got := s.SchemaVersion(); got != latestSchemaVersion {
		t.Fatalf("user_version = %d, want %d", got, latestSchemaVersion)
	}

	// Every schema-mapped document has a table after migration.
	for _, table := range []string{
		"subscriptions", "reset_schedules", "tags", "subscription_tags",
		"categories", "priority_scenes", "priority_scene_items",
		"tools", "tool_priority_scenes", "proxy_subscriptions", "proxy_tags",
		"notification_channels", "notification_settings",
		"balance_transition_states", "auth_user", "app_state",
	} {
		var name string
		err := s.db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("table %q missing after migration: %v", table, err)
		}
	}

	// Migrations are recorded once: a second open is a no-op and keeps data.
	if _, err := s.db.Exec(
		"INSERT INTO categories(name, position) VALUES('kept', 0)",
	); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	var count int
	if err := s2.db.QueryRow("SELECT COUNT(*) FROM categories").Scan(&count); err != nil {
		t.Fatalf("count categories: %v", err)
	}
	if count != 1 {
		t.Fatalf("categories after reopen = %d, want 1 (migration must not reset data)", count)
	}
	if got := s2.SchemaVersion(); got != latestSchemaVersion {
		t.Fatalf("user_version after reopen = %d, want %d", got, latestSchemaVersion)
	}
}

func TestOpenReportsUnsupportedFutureVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := db.Exec("PRAGMA user_version = 99"); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	if _, err := Open(path); err == nil {
		t.Fatal("Open succeeded on a database from a newer schema, want an error")
	}
}

func TestSnapshotRetentionKeepsNewestTen(t *testing.T) {
	dir := t.TempDir()
	clock := time.Date(2026, 11, 4, 6, 0, 0, 0, time.UTC)
	s, err := Open(filepath.Join(dir, "app.db"), WithClock(func() time.Time {
		clock = clock.Add(time.Second)
		return clock
	}))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	if err := s.WriteSubscriptionData(modelDataForSnapshot()); err != nil {
		t.Fatalf("WriteSubscriptionData: %v", err)
	}

	for i := 0; i < 12; i++ {
		if _, err := s.Snapshot(); err != nil {
			t.Fatalf("Snapshot %d: %v", i, err)
		}
	}

	snapshots, err := s.SnapshotFiles()
	if err != nil {
		t.Fatalf("SnapshotFiles: %v", err)
	}
	if len(snapshots) != 10 {
		t.Fatalf("snapshots = %d, want 10", len(snapshots))
	}
	// Newest first; the two oldest calls were pruned.
	if !filepath.IsAbs(snapshots[0]) {
		t.Fatalf("snapshot path %q is not absolute", snapshots[0])
	}
	names := make([]string, len(snapshots))
	for i, path := range snapshots {
		names[i] = filepath.Base(path)
	}
	sort.Strings(names)
	if strings.Contains(strings.Join(names, ","), "06-00-01") {
		t.Fatalf("oldest snapshot was not pruned: %v", names)
	}

	// The newest snapshot is a usable SQLite database with the same data.
	restored, err := Open(snapshots[0])
	if err != nil {
		t.Fatalf("open newest snapshot: %v", err)
	}
	defer restored.Close()
	subs, err := restored.Subscriptions()
	if err != nil {
		t.Fatalf("read restored subscriptions: %v", err)
	}
	if len(subs) != 1 || subs[0].Name != "Snapshot Subject" {
		t.Fatalf("restored subscriptions = %#v", subs)
	}
}

func TestSnapshotUsesSeparateDirectory(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	path, err := s.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if got := filepath.Dir(path); got != filepath.Join(dir, "backups") {
		t.Fatalf("snapshot dir = %q, want %q", got, filepath.Join(dir, "backups"))
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("snapshot file missing: %v", err)
	}
}
