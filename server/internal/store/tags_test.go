package store

// Parity port of __tests__/tags.test.ts (6 cases). Case 1 — "migrates existing
// data with an empty tag catalog" — lives in import_test.go because the legacy
// JSON reading path is the one-way importer (ADR-0017); the remaining five
// cases exercise the same public behaviour through the SQLite store.

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"ai-subscriptions/internal/model"
)

func subscriptionInput(name string) SubscriptionInput {
	return SubscriptionInput{
		Name:             name,
		Category:         "AI助手",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "active",
	}
}

func tagNames(t *testing.T, s *Store) []string {
	t.Helper()
	tags, err := s.Tags()
	if err != nil {
		t.Fatalf("Tags: %v", err)
	}
	names := make([]string, len(tags))
	for i, tag := range tags {
		names[i] = tag.Name
	}
	return names
}

// tags.test.ts: "trims names, reuses exact matches, and keeps case-sensitive
// names distinct".
func TestCreateSubscriptionTrimsReusesAndKeepsCaseSensitiveTags(t *testing.T) {
	s := openTestStore(t)

	first, err := s.CreateSubscription(subscriptionInput("First"), []string{" Stable ", "stable", "Stable"})
	if err != nil {
		t.Fatalf("CreateSubscription(first): %v", err)
	}
	second, err := s.CreateSubscription(subscriptionInput("Second"), []string{"Stable"})
	if err != nil {
		t.Fatalf("CreateSubscription(second): %v", err)
	}

	if got := tagNames(t, s); !reflect.DeepEqual(got, []string{"Stable", "stable"}) {
		t.Fatalf("tag catalog = %#v, want [Stable stable]", got)
	}
	if len(first.TagIDs) != 2 {
		t.Fatalf("first tagIds = %#v, want 2 ids", first.TagIDs)
	}
	if !reflect.DeepEqual(second.TagIDs, []string{first.TagIDs[0]}) {
		t.Fatalf("second tagIds = %#v, want reuse of %q", second.TagIDs, first.TagIDs[0])
	}
}

// tags.test.ts: "rejects invalid tag sets without writing partial data".
func TestCreateSubscriptionRejectsInvalidTagsWithoutPartialWrites(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.CreateSubscription(subscriptionInput("Existing"), []string{"Stable"}); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	before, err := s.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}

	_, err = s.CreateSubscription(subscriptionInput("Invalid"), []string{"New tag", "not,allowed"})
	if err == nil {
		t.Fatal("CreateSubscription with a comma in a tag succeeded, want error")
	}
	if !strings.Contains(err.Error(), "逗") {
		t.Fatalf("error = %q, want it to mention 逗号", err)
	}

	after, err := s.ReadSubscriptionData()
	if err != nil {
		t.Fatalf("ReadSubscriptionData: %v", err)
	}
	if !reflect.DeepEqual(after.Tags, before.Tags) {
		t.Fatalf("tags changed: before=%#v after=%#v", before.Tags, after.Tags)
	}
	if !reflect.DeepEqual(after.Subscriptions, before.Subscriptions) {
		t.Fatalf("subscriptions changed: before=%#v after=%#v", before.Subscriptions, after.Subscriptions)
	}
}

// tags.test.ts: "enforces the per-subscription tag limit".
func TestCreateSubscriptionEnforcesTagLimit(t *testing.T) {
	s := openTestStore(t)
	names := make([]string, 21)
	for i := range names {
		names[i] = "tag-" + string(rune('a'+i))
	}

	_, err := s.CreateSubscription(subscriptionInput("Too many"), names)
	if err == nil || !strings.Contains(err.Error(), "最多添加 20 个标签") {
		t.Fatalf("error = %v, want the 20-tag limit message", err)
	}

	subs, err := s.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	if len(subs) != 0 {
		t.Fatalf("subscriptions = %#v, want none", subs)
	}
	if got := tagNames(t, s); len(got) != 0 {
		t.Fatalf("tags = %#v, want none", got)
	}
}

// tags.test.ts: "renames by stable ID and rejects exact-name conflicts".
func TestRenameTagByStableIDRejectsExactNameConflicts(t *testing.T) {
	s := openTestStore(t)
	tagged, err := s.CreateSubscription(subscriptionInput("Tagged"), []string{"Stable", "Fast"})
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	var stable, fast model.Tag
	for _, tag := range mustTags(t, s) {
		switch tag.Name {
		case "Stable":
			stable = tag
		case "Fast":
			fast = tag
		}
	}

	renamed, err := s.RenameTag(stable.ID, "Reliable")
	if err != nil {
		t.Fatalf("RenameTag: %v", err)
	}
	if renamed == nil || renamed.Name != "Reliable" {
		t.Fatalf("renamed = %#v, want Reliable", renamed)
	}

	saved, err := s.SubscriptionByID(tagged.ID)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if !reflect.DeepEqual(saved.TagIDs, tagged.TagIDs) {
		t.Fatalf("tagIds changed across rename: %#v vs %#v", saved.TagIDs, tagged.TagIDs)
	}

	if _, err := s.RenameTag(fast.ID, "Reliable"); err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("conflicting rename error = %v, want 已存在", err)
	}
}

// tags.test.ts: "deletes a tag and removes its association from every
// subscription".
func TestDeleteTagRemovesAssociationsFromEverySubscription(t *testing.T) {
	s := openTestStore(t)
	first, err := s.CreateSubscription(subscriptionInput("First"), []string{"Stable"})
	if err != nil {
		t.Fatalf("CreateSubscription(first): %v", err)
	}
	second, err := s.CreateSubscription(subscriptionInput("Second"), []string{"Stable", "Fast"})
	if err != nil {
		t.Fatalf("CreateSubscription(second): %v", err)
	}

	var stableID string
	for _, tag := range mustTags(t, s) {
		if tag.Name == "Stable" {
			stableID = tag.ID
		}
	}

	result, err := s.DeleteTag(stableID)
	if err != nil {
		t.Fatalf("DeleteTag: %v", err)
	}
	if result == nil {
		t.Fatal("DeleteTag returned nil for an existing tag")
	}
	if !reflect.DeepEqual(result.AffectedSubscriptionIDs, []string{first.ID, second.ID}) {
		t.Fatalf("affected = %#v, want [%s %s]", result.AffectedSubscriptionIDs, first.ID, second.ID)
	}

	if got := tagNames(t, s); !reflect.DeepEqual(got, []string{"Fast"}) {
		t.Fatalf("tags after delete = %#v, want [Fast]", got)
	}

	ids := make([]string, 0, 2)
	for _, sub := range mustSubscriptions(t, s) {
		if len(sub.TagIDs) != 0 && sub.ID == first.ID {
			t.Fatalf("first tagIds = %#v, want empty", sub.TagIDs)
		}
		if sub.ID == second.ID {
			if !reflect.DeepEqual(sub.TagIDs, []string{second.TagIDs[1]}) {
				t.Fatalf("second tagIds = %#v, want [%s]", sub.TagIDs, second.TagIDs[1])
			}
		}
		ids = append(ids, sub.ID)
	}
	sort.Strings(ids)
	if len(ids) != 2 {
		t.Fatalf("subscriptions = %v, want 2", ids)
	}
}

func mustTags(t *testing.T, s *Store) []model.Tag {
	t.Helper()
	tags, err := s.Tags()
	if err != nil {
		t.Fatalf("Tags: %v", err)
	}
	return tags
}

func mustSubscriptions(t *testing.T, s *Store) []model.Subscription {
	t.Helper()
	subs, err := s.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	return subs
}
