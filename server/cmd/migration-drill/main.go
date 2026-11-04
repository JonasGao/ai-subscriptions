// Command migration-drill rehearses the ADR-0017 JSON→SQLite migration on a
// copy of a legacy data directory and verifies that nothing was lost.
//
// The source directory is never modified: the known legacy documents are
// copied into a scratch directory first, then imported and cross-checked
// against the source JSON. Run it from server/:
//
//	go run ./cmd/migration-drill --source ~/docker/ai-subscriptions/data
//
// Exit status is non-zero when any verification fails, so the drill can gate a
// cutover.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

var legacyFiles = []string{
	"subscriptions.json",
	"priorities.json",
	"tools.json",
	"tool-priorities.json",
	"proxy-subscriptions.json",
	"notifications.json",
	"auth.json",
	"last-monthly-reset.json",
}

func main() {
	source := flag.String("source", "", "legacy data directory holding data/*.json (required)")
	work := flag.String("work", "", "scratch directory (default: a fresh temp dir)")
	keep := flag.Bool("keep", false, "keep the scratch directory after the drill")
	flag.Parse()

	if *source == "" {
		fmt.Fprintln(os.Stderr, "migration-drill: --source is required")
		os.Exit(2)
	}
	if err := run(*source, *work, *keep); err != nil {
		fmt.Fprintf(os.Stderr, "migration-drill: %v\n", err)
		os.Exit(1)
	}
}

func run(source, work string, keep bool) error {
	info, err := os.Stat(source)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("source %q is not a readable directory", source)
	}

	scratch, cleanup, err := prepareScratch(source, work, keep)
	if err != nil {
		return err
	}
	defer cleanup()

	fmt.Printf("source:  %s\nscratch: %s\n", source, scratch)

	st, err := store.Open(filepath.Join(scratch, "app.db"), store.WithoutLegacyImport())
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	report, err := st.ImportLegacyJSON(scratch)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	if !report.Imported {
		return fmt.Errorf("import did not run (marker already set or no documents found)")
	}

	fmt.Printf("imported: %d document(s)\n", len(report.Files))
	for _, name := range report.Files {
		fmt.Printf("  - %s\n", name)
	}
	if len(report.Snapshots) > 0 {
		fmt.Printf("snapshot: %s (+%d more)\n", report.Snapshots[0], len(report.Snapshots)-1)
	}

	problems, err := verify(source, st)
	if err != nil {
		return err
	}

	// A second import must be a no-op: migration is one-way and idempotent.
	again, err := st.ImportLegacyJSON(scratch)
	if err != nil {
		return fmt.Errorf("second import: %w", err)
	}
	if again.Imported {
		problems = append(problems, "second import re-ran instead of being a no-op")
	}

	if len(problems) > 0 {
		fmt.Println("\nFAILED:")
		for _, problem := range problems {
			fmt.Printf("  ✗ %s\n", problem)
		}
		return fmt.Errorf("%d verification failure(s)", len(problems))
	}

	fmt.Println("\nOK: every legacy document round-trips, ciphertext is byte-identical,")
	fmt.Println("    and re-running the import is a no-op.")
	return nil
}

func prepareScratch(source, work string, keep bool) (string, func(), error) {
	scratch := work
	cleanup := func() {}
	if scratch == "" {
		dir, err := os.MkdirTemp("", "ai-subscriptions-drill-")
		if err != nil {
			return "", nil, fmt.Errorf("create scratch dir: %w", err)
		}
		scratch = dir
		if !keep {
			cleanup = func() { _ = os.RemoveAll(dir) }
		}
	} else if err := os.MkdirAll(scratch, 0o755); err != nil {
		return "", nil, fmt.Errorf("create scratch dir: %w", err)
	} else if entries, err := os.ReadDir(scratch); err != nil {
		return "", nil, fmt.Errorf("read scratch dir: %w", err)
	} else if len(entries) > 0 {
		return "", nil, fmt.Errorf("scratch dir %q is not empty", scratch)
	}

	copied := 0
	for _, name := range legacyFiles {
		body, err := os.ReadFile(filepath.Join(source, name))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", nil, fmt.Errorf("read %s: %w", name, err)
		}
		if err := os.WriteFile(filepath.Join(scratch, name), body, 0o644); err != nil {
			return "", nil, fmt.Errorf("copy %s: %w", name, err)
		}
		copied++
	}
	if copied == 0 {
		return "", nil, fmt.Errorf("source %q contains none of the legacy documents", source)
	}
	return scratch, cleanup, nil
}

// verify cross-checks the imported database against the source JSON files.
func verify(source string, st *store.Store) ([]string, error) {
	var problems []string

	if raw, err := readFile(source, "subscriptions.json"); err == nil {
		var legacy struct {
			Subscriptions []struct {
				Name        string `json:"name"`
				Credentials string `json:"credentials"`
			} `json:"subscriptions"`
			Categories []string    `json:"categories"`
			Tags       []model.Tag `json:"tags"`
		}
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return nil, fmt.Errorf("parse source subscriptions.json: %w", err)
		}
		data, err := st.ReadSubscriptionData()
		if err != nil {
			return nil, err
		}
		if len(data.Subscriptions) != len(legacy.Subscriptions) {
			problems = append(problems, fmt.Sprintf(
				"subscriptions: imported %d, source %d",
				len(data.Subscriptions), len(legacy.Subscriptions)))
		}
		if expected := normalizeCategories(legacy.Categories); !reflect.DeepEqual(data.Categories, expected) {
			problems = append(problems, fmt.Sprintf("categories: imported %v, source %v", data.Categories, expected))
		}
		if len(data.Tags) != len(legacy.Tags) {
			problems = append(problems, fmt.Sprintf("tags: imported %d, source %d", len(data.Tags), len(legacy.Tags)))
		}

		// Ciphertext must be byte-identical per subscription name (names need
		// not be unique, so pair them in document order).
		imported := make(map[string][]string)
		for _, sub := range data.Subscriptions {
			imported[sub.Name] = append(imported[sub.Name], sub.Credentials)
		}
		for _, sub := range legacy.Subscriptions {
			if sub.Credentials == "" {
				continue
			}
			matches := imported[sub.Name]
			if len(matches) == 0 {
				problems = append(problems, fmt.Sprintf("subscription %q missing after import", sub.Name))
				continue
			}
			found := false
			for _, candidate := range matches {
				if candidate == sub.Credentials {
					found = true
					break
				}
			}
			if !found {
				problems = append(problems, fmt.Sprintf("subscription %q: credentials ciphertext differs", sub.Name))
			}
		}
	}

	if raw, err := readFile(source, "priorities.json"); err == nil {
		var doc model.PriorityData
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.PriorityData()
		if err != nil {
			return nil, err
		}
		if len(got.Scenes) != len(doc.Scenes) {
			problems = append(problems, fmt.Sprintf("priority scenes: imported %d, source %d", len(got.Scenes), len(doc.Scenes)))
		}
	}

	if raw, err := readFile(source, "tools.json"); err == nil {
		var doc model.ToolData
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.ToolData()
		if err != nil {
			return nil, err
		}
		if len(got.Tools) != len(doc.Tools) {
			problems = append(problems, fmt.Sprintf("tools: imported %d, source %d", len(got.Tools), len(doc.Tools)))
		}
	}

	if raw, err := readFile(source, "tool-priorities.json"); err == nil {
		var doc model.ToolPriorityData
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.ToolPriorityData()
		if err != nil {
			return nil, err
		}
		if len(got.Scenes) != len(doc.Scenes) {
			problems = append(problems, fmt.Sprintf("tool priority scenes: imported %d, source %d", len(got.Scenes), len(doc.Scenes)))
		}
	}

	if raw, err := readFile(source, "proxy-subscriptions.json"); err == nil {
		var doc model.ProxySubscriptionData
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.ProxySubscriptionData()
		if err != nil {
			return nil, err
		}
		if len(got.Subscriptions) != len(doc.Subscriptions) || len(got.Tags) != len(doc.Tags) {
			problems = append(problems, fmt.Sprintf(
				"proxy: imported %d subscriptions/%d tags, source %d/%d",
				len(got.Subscriptions), len(got.Tags), len(doc.Subscriptions), len(doc.Tags)))
		}
	}

	if raw, err := readFile(source, "notifications.json"); err == nil {
		var doc model.NotificationData
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.NotificationData()
		if err != nil {
			return nil, err
		}
		if len(got.Channels) != len(doc.Channels) {
			problems = append(problems, fmt.Sprintf("notification channels: imported %d, source %d", len(got.Channels), len(doc.Channels)))
		}
		if len(got.BalanceTransitionStates) != len(doc.BalanceTransitionStates) {
			problems = append(problems, fmt.Sprintf(
				"balance transition states: imported %d, source %d",
				len(got.BalanceTransitionStates), len(doc.BalanceTransitionStates)))
		}
		// Secret material must survive verbatim (it is stored as plaintext in
		// the legacy document too).
		sourceSecrets := make([]string, 0, len(doc.Channels))
		for _, channel := range doc.Channels {
			sourceSecrets = append(sourceSecrets, channel.AppSecret, channel.Secret)
		}
		importedSecrets := make([]string, 0, len(got.Channels))
		for _, channel := range got.Channels {
			importedSecrets = append(importedSecrets, channel.AppSecret, channel.Secret)
		}
		if !reflect.DeepEqual(sortedNonEmpty(sourceSecrets), sortedNonEmpty(importedSecrets)) {
			problems = append(problems, "notification secrets differ after import")
		}
	}

	if raw, err := readFile(source, "auth.json"); err == nil {
		var doc model.AuthData
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.AuthData()
		if err != nil {
			return nil, err
		}
		if got == nil || got.Username != doc.Username || got.PasswordHash != doc.PasswordHash || got.IsInitial != doc.IsInitial {
			problems = append(problems, "auth row differs after import")
		}
	}

	if raw, err := readFile(source, "last-monthly-reset.json"); err == nil {
		var doc model.LastMonthlyReset
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		got, err := st.AppState("last-monthly-reset")
		if err != nil {
			return nil, err
		}
		if got != doc.LastReset {
			problems = append(problems, fmt.Sprintf("last-monthly-reset: imported %q, source %q", got, doc.LastReset))
		}
	}

	return problems, nil
}

func readFile(dir, name string) ([]byte, error) {
	return os.ReadFile(filepath.Join(dir, name))
}

// normalizeCategories ports readData's "AI助手" → "官方订阅" rename and
// de-duplication.
func normalizeCategories(categories []string) []string {
	out := make([]string, 0, len(categories))
	seen := make(map[string]struct{}, len(categories))
	for _, category := range categories {
		if category == "AI助手" {
			category = "官方订阅"
		}
		if _, dup := seen[category]; dup {
			continue
		}
		seen[category] = struct{}{}
		out = append(out, category)
	}
	return out
}

func sortedNonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
