package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ai-subscriptions/internal/store"
)

func writeLegacySubscriptions(t *testing.T, dir string, payload map[string]any) {
	t.Helper()
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		t.Fatalf("marshal subscriptions.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "subscriptions.json"), raw, 0o644); err != nil {
		t.Fatalf("write subscriptions.json: %v", err)
	}
}

func openDrillStore(t *testing.T, dir string) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(dir, "app.db"), store.WithoutLegacyImport())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func legacySubscription(id, name, category string) map[string]any {
	return map[string]any{
		"id": id, "name": name, "category": category,
		"provider": "openai", "subscriptionType": "recurring",
		"billingCycle": "monthly", "price": 20, "status": "active",
		"createdAt": "2024-01-01T00:00:00.000Z",
		"updatedAt": "2024-01-01T00:00:00.000Z",
	}
}

// The drill must notice when the catalogue was renamed but a subscription still
// references the retired category — the exact defect ticket #23 fixed.
func TestVerifyReportsSubscriptionCategoryMismatch(t *testing.T) {
	dir := t.TempDir()
	writeLegacySubscriptions(t, dir, map[string]any{
		"subscriptions": []any{
			legacySubscription("sub-1", "Retired", "AI助手"),
			legacySubscription("sub-2", "Other", "中转站"),
		},
		"categories": []string{"AI助手", "中转站"},
		"tags":       []any{},
	})

	st := openDrillStore(t, dir)
	if _, err := st.ImportLegacyJSON(dir); err != nil {
		t.Fatalf("ImportLegacyJSON: %v", err)
	}

	// Simulate the pre-fix importer: catalogue renamed, references left behind.
	data, err := st.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}
	for i := range data.Subscriptions {
		if data.Subscriptions[i].Name == "Retired" {
			data.Subscriptions[i].Category = "AI助手"
		}
	}
	if err := st.WriteSubscriptionData(data); err != nil {
		t.Fatalf("WriteSubscriptionData: %v", err)
	}

	problems, err := verify(dir, st)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !containsSubstring(problems, "category imported \"AI助手\"") {
		t.Fatalf("problems = %#v, want a per-subscription category mismatch", problems)
	}
	if !containsSubstring(problems, "not in the imported category list") {
		t.Fatalf("problems = %#v, want the dangling-category problem", problems)
	}
}

// A healthy import must pass the strengthened verify without false positives.
func TestVerifyAcceptsNormalizedCategories(t *testing.T) {
	dir := t.TempDir()
	writeLegacySubscriptions(t, dir, map[string]any{
		"subscriptions": []any{
			legacySubscription("sub-1", "Retired", "AI助手"),
			legacySubscription("sub-2", "Current", "官方订阅"),
			legacySubscription("sub-3", "Other", "中转站"),
		},
		"categories": []string{"AI助手", "官方订阅", "中转站"},
		"tags":       []any{},
	})

	st := openDrillStore(t, dir)
	if _, err := st.ImportLegacyJSON(dir); err != nil {
		t.Fatalf("ImportLegacyJSON: %v", err)
	}

	problems, err := verify(dir, st)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if len(problems) > 0 {
		t.Fatalf("problems = %#v, want none", problems)
	}
}

func containsSubstring(values []string, substring string) bool {
	for _, value := range values {
		if strings.Contains(value, substring) {
			return true
		}
	}
	return false
}
