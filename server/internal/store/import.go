package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/reset"
)

// legacyFileNames are the documents the old stack kept in DATA_DIR.
var legacyFileNames = []string{
	"subscriptions.json",
	"priorities.json",
	"tools.json",
	"tool-priorities.json",
	"proxy-subscriptions.json",
	"notifications.json",
	"auth.json",
	"last-monthly-reset.json",
}

// ImportReport describes one legacy import attempt.
type ImportReport struct {
	Imported bool
	Files    []string
	// Snapshots are the pre-import copies, one per imported document.
	Snapshots []string
	Counts    map[string]int
}

// legacy JSON shapes. The embedded model struct plus the old-only fields keeps
// the decode faithful while letting the importer drop what no longer exists.
type legacySubscription struct {
	model.Subscription
	APIKey         string           `json:"apiKey"`
	ResetSchedules []legacySchedule `json:"resetSchedules"`
}

type legacySchedule struct {
	model.ResetSchedule
	ReferenceTime  json.RawMessage `json:"referenceTime"`
	TimezoneOffset json.RawMessage `json:"timezoneOffset"`
}

type legacySubscriptionFile struct {
	Subscriptions []legacySubscription `json:"subscriptions"`
	Categories    []string             `json:"categories"`
	Tags          []model.Tag          `json:"tags"`
}

// importLegacyIfNeeded runs the one-way JSON migration when the data directory
// still holds documents from the old stack (ADR-0017).
func (s *Store) importLegacyIfNeeded(dataDir string) error {
	_, err := s.ImportLegacyJSON(dataDir)
	return err
}

// ImportLegacyJSON imports every known legacy document found in dataDir.
//
// It first snapshots the JSON files (copying them to <file>.backup-<stamp>),
// then writes everything in a single transaction. Re-running is a no-op: a
// marker in app_state records the completed import.
func (s *Store) ImportLegacyJSON(dataDir string) (ImportReport, error) {
	report := ImportReport{Counts: map[string]int{}}

	marker, err := s.AppState(legacyImportMarker)
	if err != nil {
		return report, err
	}
	if marker != "" {
		return report, nil
	}

	files := make([]string, 0, len(legacyFileNames))
	for _, name := range legacyFileNames {
		path := filepath.Join(dataDir, name)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			files = append(files, name)
		}
	}
	if len(files) == 0 {
		return report, nil
	}

	// A non-empty store without the marker means an interrupted earlier import
	// or a hand-written database. Refuse instead of importing on top of live
	// data: the JSON documents stay untouched for a human to reconcile.
	hasData, err := s.hasData()
	if err != nil {
		return report, err
	}
	if hasData {
		return report, errors.New(
			"database already contains data but has no legacy-import marker; refusing to auto-import",
		)
	}

	// Snapshot first, unconditionally: even an import that fails to parse
	// leaves the operator a copy of exactly what was on disk.
	snapshots, err := snapshotLegacyFiles(dataDir, files, snapshotTimestamp(s.now()))
	if err != nil {
		return report, err
	}
	report.Snapshots = snapshots
	report.Files = files
	s.legacySnapshot = snapshotFor("subscriptions.json", snapshots)

	parsed, err := parseLegacyDocuments(dataDir, files, s.cipher)
	if err != nil {
		return report, err
	}

	// Documents and the completion marker commit together: a partial import
	// can never leave data behind without the marker that guards re-import.
	if err := s.writeLegacyDocuments(parsed, report.Counts, s.nowISO()); err != nil {
		return report, err
	}
	report.Imported = true
	return report, nil
}

const legacyImportMarker = "legacy_json_imported_at"

type legacyDocuments struct {
	subscriptions    *model.SubscriptionData
	priorities       *model.PriorityData
	tools            *model.ToolData
	toolPriorities   *model.ToolPriorityData
	proxy            *model.ProxySubscriptionData
	notifications    *model.NotificationData
	auth             *model.AuthData
	lastMonthlyReset string
}

func parseLegacyDocuments(dataDir string, files []string, cipher *crypto.Cipher) (*legacyDocuments, error) {
	docs := &legacyDocuments{}

	for _, name := range files {
		path := filepath.Join(dataDir, name)
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", name, err)
		}
		switch name {
		case "subscriptions.json":
			var raw legacySubscriptionFile
			if err := json.Unmarshal(body, &raw); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			normalized, err := normalizeLegacySubscriptions(&raw, cipher)
			if err != nil {
				return nil, fmt.Errorf("normalize %s: %w", name, err)
			}
			docs.subscriptions = normalized
		case "priorities.json":
			var doc model.PriorityData
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.priorities = &doc
		case "tools.json":
			var doc model.ToolData
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.tools = &doc
		case "tool-priorities.json":
			var doc model.ToolPriorityData
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.toolPriorities = &doc
		case "proxy-subscriptions.json":
			var doc model.ProxySubscriptionData
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.proxy = &doc
		case "notifications.json":
			var doc model.NotificationData
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.notifications = &doc
		case "auth.json":
			var doc model.AuthData
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.auth = &doc
		case "last-monthly-reset.json":
			var doc model.LastMonthlyReset
			if err := json.Unmarshal(body, &doc); err != nil {
				return nil, fmt.Errorf("parse %s: %w", name, err)
			}
			docs.lastMonthlyReset = doc.LastReset
		}
	}
	return docs, nil
}

// normalizeLegacySubscriptions ports the migration rules readData applied on
// every load in lib/db.ts, now applied exactly once at import time:
//   - category "AI助手" renamed to "官方订阅" (deduplicated)
//   - tags default to [], unknown tag ids dropped, ids deduplicated
//   - subscriptionType defaults to recurring, billingCycle to monthly
//   - legacy apiKey migrated into the credentials blob
//   - invalid/duplicate schedules dropped, exhausted defaulted to false
func normalizeLegacySubscriptions(raw *legacySubscriptionFile, cipher *crypto.Cipher) (*model.SubscriptionData, error) {
	categories := make([]string, 0, len(raw.Categories))
	seenCategories := make(map[string]struct{}, len(raw.Categories))
	for _, category := range raw.Categories {
		if category == "AI助手" {
			category = "官方订阅"
		}
		if _, dup := seenCategories[category]; dup {
			continue
		}
		seenCategories[category] = struct{}{}
		categories = append(categories, category)
	}

	tags := raw.Tags
	if tags == nil {
		tags = []model.Tag{}
	}
	knownTagIDs := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		knownTagIDs[tag.ID] = struct{}{}
	}

	subscriptions := make([]model.Subscription, 0, len(raw.Subscriptions))
	for _, legacy := range raw.Subscriptions {
		sub := legacy.Subscription

		sub.TagIDs = filterKnownTagIDs(legacy.Subscription.TagIDs, knownTagIDs)
		sub.SubscriptionType = defaultString(sub.SubscriptionType, "recurring")
		sub.BillingCycle = defaultString(sub.BillingCycle, "monthly")

		if legacy.APIKey != "" && sub.Credentials == "" {
			plain := legacy.APIKey
			if strings.Contains(plain, ":") {
				decrypted, err := cipher.DecryptAPIKey(plain)
				if err != nil {
					return nil, fmt.Errorf("migrate apiKey for %q: %w", sub.Name, err)
				}
				plain = decrypted
			}
			encrypted, err := cipher.EncryptCredentials(map[string]string{"apiKey": plain})
			if err != nil {
				return nil, fmt.Errorf("encrypt migrated apiKey for %q: %w", sub.Name, err)
			}
			sub.Credentials = encrypted
		}

		schedules := make([]model.ResetSchedule, 0, len(legacy.ResetSchedules))
		for _, legacySchedule := range legacy.ResetSchedules {
			// The old validator rejected schedules that still carried the
			// retired referenceTime / timezoneOffset fields.
			if len(legacySchedule.ReferenceTime) > 0 || len(legacySchedule.TimezoneOffset) > 0 {
				continue
			}
			schedule := legacySchedule.ResetSchedule
			if err := reset.Validate(resetSpec(schedule)); err != nil {
				continue
			}
			schedules = append(schedules, schedule)
		}

		deduped := dedupeSchedulesByType(schedules)
		if len(deduped) != len(schedules) {
			sub.ResetSchedules = deduped
			// A dropped duplicate may have been the exhausted one that drove
			// the stored status; recompute so status matches what survived.
			sub.Status = deriveStatus(sub)
		} else {
			sub.ResetSchedules = schedules
		}

		subscriptions = append(subscriptions, sub)
	}

	return &model.SubscriptionData{
		Subscriptions: subscriptions,
		Categories:    categories,
		Tags:          tags,
	}, nil
}

func filterKnownTagIDs(tagIDs []string, known map[string]struct{}) []string {
	filtered := make([]string, 0, len(tagIDs))
	seen := make(map[string]struct{}, len(tagIDs))
	for _, tagID := range tagIDs {
		if _, ok := known[tagID]; !ok {
			continue
		}
		if _, dup := seen[tagID]; dup {
			continue
		}
		seen[tagID] = struct{}{}
		filtered = append(filtered, tagID)
	}
	return filtered
}

// dedupeSchedulesByType keeps the earliest-created schedule per type, in
// first-seen type order (readData's behaviour).
func dedupeSchedulesByType(schedules []model.ResetSchedule) []model.ResetSchedule {
	indexByType := make(map[string]int, len(schedules))
	out := make([]model.ResetSchedule, 0, len(schedules))
	for _, schedule := range schedules {
		index, exists := indexByType[schedule.Type]
		if !exists {
			indexByType[schedule.Type] = len(out)
			out = append(out, schedule)
			continue
		}
		if schedule.CreatedAt < out[index].CreatedAt {
			out[index] = schedule
		}
	}
	return out
}

// snapshotLegacyFiles copies each imported document next to itself using the
// old stack's backup stamp, and returns the copies' paths.
func snapshotLegacyFiles(dataDir string, files []string, stamp string) ([]string, error) {
	snapshots := make([]string, 0, len(files))
	for _, name := range files {
		source := filepath.Join(dataDir, name)
		body, err := os.ReadFile(source)
		if err != nil {
			return nil, fmt.Errorf("read %s for snapshot: %w", name, err)
		}
		target := source + ".backup-" + stamp
		if err := os.WriteFile(target, body, 0o644); err != nil {
			return nil, fmt.Errorf("write snapshot %s: %w", target, err)
		}
		snapshots = append(snapshots, target)
	}
	return snapshots, nil
}

func snapshotFor(name string, snapshots []string) string {
	for _, snapshot := range snapshots {
		if strings.Contains(filepath.Base(snapshot), name+".backup-") {
			return snapshot
		}
	}
	return ""
}

// LegacySnapshotPath returns the pre-import JSON snapshot for
// subscriptions.json (empty when no import ran in this process).
func (s *Store) LegacySnapshotPath() string {
	return s.legacySnapshot
}

func (s *Store) hasData() (bool, error) {
	ctx := context.Background()
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM subscriptions").Scan(&count); err != nil {
		return false, fmt.Errorf("count subscriptions: %w", err)
	}
	if count > 0 {
		return true, nil
	}
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM categories").Scan(&count); err != nil {
		return false, fmt.Errorf("count categories: %w", err)
	}
	return count > 0, nil
}

func (s *Store) writeLegacyDocuments(docs *legacyDocuments, counts map[string]int, importedAt string) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if docs.subscriptions != nil {
			if err := s.writeSubscriptionData(ctx, tx, docs.subscriptions); err != nil {
				return err
			}
			counts["subscriptions"] = len(docs.subscriptions.Subscriptions)
			counts["categories"] = len(docs.subscriptions.Categories)
			counts["tags"] = len(docs.subscriptions.Tags)
		}
		if docs.priorities != nil {
			if err := writePriorityDataTx(ctx, tx, docs.priorities); err != nil {
				return err
			}
			counts["priorityScenes"] = len(docs.priorities.Scenes)
		}
		if docs.tools != nil {
			if err := writeToolDataTx(ctx, tx, docs.tools); err != nil {
				return err
			}
			counts["tools"] = len(docs.tools.Tools)
		}
		if docs.toolPriorities != nil {
			if err := writeToolPriorityDataTx(ctx, tx, docs.toolPriorities); err != nil {
				return err
			}
			counts["toolPriorityScenes"] = len(docs.toolPriorities.Scenes)
		}
		if docs.proxy != nil {
			if err := writeProxyDataTx(ctx, tx, docs.proxy); err != nil {
				return err
			}
			counts["proxySubscriptions"] = len(docs.proxy.Subscriptions)
			counts["proxyTags"] = len(docs.proxy.Tags)
		}
		if docs.notifications != nil {
			if err := writeNotificationDataTx(ctx, tx, docs.notifications); err != nil {
				return err
			}
			counts["notificationChannels"] = len(docs.notifications.Channels)
		}
		if docs.auth != nil {
			if err := writeAuthDataTx(ctx, tx, docs.auth); err != nil {
				return err
			}
			counts["authUsers"] = 1
		}
		if docs.lastMonthlyReset != "" {
			if _, err := tx.ExecContext(ctx,
				"INSERT OR REPLACE INTO app_state(key, value) VALUES(?, ?)",
				"last-monthly-reset", docs.lastMonthlyReset); err != nil {
				return fmt.Errorf("write last-monthly-reset: %w", err)
			}
			counts["lastMonthlyReset"] = 1
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT OR REPLACE INTO app_state(key, value) VALUES(?, ?)",
			legacyImportMarker, importedAt); err != nil {
			return fmt.Errorf("write legacy import marker: %w", err)
		}
		return nil
	})
}

// ---------- secondary documents ----------

// AppState returns a persisted scalar, or "" when absent.
func (s *Store) AppState(key string) (string, error) {
	var value string
	err := s.db.QueryRow("SELECT value FROM app_state WHERE key = ?", key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read app_state %q: %w", key, err)
	}
	return value, nil
}

// SetAppState writes a persisted scalar.
func (s *Store) SetAppState(key, value string) error {
	_, err := s.db.Exec("INSERT OR REPLACE INTO app_state(key, value) VALUES(?, ?)", key, value)
	if err != nil {
		return fmt.Errorf("write app_state %q: %w", key, err)
	}
	return nil
}

// AuthData returns the single auth row, or nil when none was imported.
func (s *Store) AuthData() (*model.AuthData, error) {
	var auth model.AuthData
	var isInitial int
	err := s.db.QueryRow(`
		SELECT username, password_hash, created_at, updated_at, is_initial
		FROM auth_user WHERE id = 1`).Scan(
		&auth.Username, &auth.PasswordHash, &auth.CreatedAt, &auth.UpdatedAt, &isInitial,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read auth_user: %w", err)
	}
	auth.IsInitial = isInitial != 0
	return &auth, nil
}

// WriteAuthData replaces the single auth row.
func (s *Store) WriteAuthData(auth *model.AuthData) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error { return writeAuthDataTx(ctx, tx, auth) })
}

func writeAuthDataTx(ctx context.Context, tx *sql.Tx, auth *model.AuthData) error {
	_, err := tx.ExecContext(ctx, `
		INSERT OR REPLACE INTO auth_user(id, username, password_hash, created_at, updated_at, is_initial)
		VALUES(1, ?, ?, ?, ?, ?)`,
		auth.Username, auth.PasswordHash, auth.CreatedAt, auth.UpdatedAt, boolInt(auth.IsInitial))
	if err != nil {
		return fmt.Errorf("write auth_user: %w", err)
	}
	return nil
}
