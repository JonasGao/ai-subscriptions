package store

// Behaviour of the subscription write APIs (ticket #26). The old stack's
// updateSubscription/createSubscription in lib/db.ts is the specification; the
// cases below pin the rules the HTTP layer relies on.

import (
	"reflect"
	"strings"
	"testing"

	"ai-subscriptions/internal/model"
)

func stringPtr(value string) *string { return &value }

func exhaustedSchedule(id string, exhausted bool) model.ResetSchedule {
	return model.ResetSchedule{
		ID:            id,
		Enabled:       true,
		Type:          "monthly",
		NextResetTime: "2026-09-01T00:00:00.000Z",
		Exhausted:     exhausted,
		CreatedAt:     "2026-08-01T00:00:00.000Z",
		UpdatedAt:     "2026-08-01T00:00:00.000Z",
	}
}

func TestUpdateSubscriptionReplacesFieldsAndKeepsIdentity(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(subscriptionInput("Original"), []string{"Stable"})
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	threshold := 12.5
	updated, err := s.UpdateSubscription(created.ID, SubscriptionUpdates{
		Name:                stringPtr("Renamed"),
		Notes:               stringPtr("touched"),
		LowBalanceThreshold: &threshold,
	}, nil)
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}
	if updated == nil {
		t.Fatal("UpdateSubscription returned nil for an existing subscription")
	}

	if updated.Name != "Renamed" || updated.Notes != "touched" {
		t.Fatalf("updated = %#v, want Renamed/touched", updated)
	}
	if updated.ID != created.ID || updated.CreatedAt != created.CreatedAt {
		t.Fatalf("identity changed: %#v vs %#v", updated, created)
	}
	if !reflect.DeepEqual(updated.TagIDs, created.TagIDs) {
		t.Fatalf("tagIds changed without tagNames: %#v vs %#v", updated.TagIDs, created.TagIDs)
	}
	if updated.LowBalanceThreshold == nil || *updated.LowBalanceThreshold != threshold {
		t.Fatalf("threshold = %v, want %v", updated.LowBalanceThreshold, threshold)
	}
}

// lib/db.ts readData normalized a missing billingCycle to "monthly" on every
// read, so the API never returned the field absent.
func TestCreateSubscriptionDefaultsBillingCycle(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(SubscriptionInput{
		Name: "One-time", Category: "官方订阅", Price: 5, SubscriptionType: "one-time",
	}, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	if created.BillingCycle != "monthly" {
		t.Fatalf("billingCycle = %q, want the stored default monthly", created.BillingCycle)
	}
}

func TestUpdateSubscriptionRewritesTagsWhenNamesProvided(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(subscriptionInput("Tagged"), []string{"Stable", "Fast"})
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	updated, err := s.UpdateSubscription(created.ID, SubscriptionUpdates{}, &[]string{"Fast", "New"})
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}

	names := tagNames(t, s)
	for _, want := range []string{"Stable", "Fast", "New"} {
		if !contains(names, want) {
			t.Fatalf("tag catalog = %#v, want it to keep %q (rename/merge keeps old tags)", names, want)
		}
	}
	if len(updated.TagIDs) != 2 {
		t.Fatalf("tagIds = %#v, want 2", updated.TagIDs)
	}
}

func TestUpdateSubscriptionValidation(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(subscriptionInput("Subject"), nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	empty := ""
	negative := -1.0
	cases := []struct {
		name    string
		updates SubscriptionUpdates
		want    string
	}{
		{"blank name", SubscriptionUpdates{Name: &empty}, "Subscription name must be a non-empty string"},
		{"negative price", SubscriptionUpdates{Price: &negative}, "Price must be a non-negative number"},
		{"invalid status", SubscriptionUpdates{Status: stringPtr("gone")}, "Invalid status value"},
		{"invalid type", SubscriptionUpdates{SubscriptionType: stringPtr("weekly")}, "Invalid subscriptionType value"},
		{"invalid cycle", SubscriptionUpdates{BillingCycle: stringPtr("weekly")}, "Invalid billingCycle value"},
		{"invalid threshold", SubscriptionUpdates{LowBalanceThreshold: &negative}, "lowBalanceThreshold must be a non-negative finite number"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := s.UpdateSubscription(created.ID, tc.updates, nil)
			if err == nil || err.Error() != tc.want {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestUpdateSubscriptionUnknownIDReturnsNil(t *testing.T) {
	s := openTestStore(t)
	updated, err := s.UpdateSubscription("missing", SubscriptionUpdates{Name: stringPtr("x")}, nil)
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}
	if updated != nil {
		t.Fatalf("updated = %#v, want nil", updated)
	}
}

func TestUpdateSubscriptionDerivesStatusWhenOnlySchedulesChange(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(SubscriptionInput{
		Name: "A", Category: "官方订阅", Price: 1, Status: "paused",
		ResetSchedules: []model.ResetSchedule{exhaustedSchedule("sched-1", true)},
	}, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	healthy := exhaustedSchedule("sched-1", false)
	updated, err := s.UpdateSubscription(created.ID, SubscriptionUpdates{
		ResetSchedules: &[]model.ResetSchedule{healthy},
	}, nil)
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}
	if updated.Status != "active" {
		t.Fatalf("status = %q, want active (schedule edit re-derives)", updated.Status)
	}
}

func TestUpdateSubscriptionHonoursExplicitStatusOverDerivation(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(SubscriptionInput{
		Name: "A", Category: "官方订阅", Price: 1, Status: "active",
		ResetSchedules: []model.ResetSchedule{exhaustedSchedule("sched-1", true)},
	}, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	updates := SubscriptionUpdates{
		Status:         stringPtr("paused"),
		ResetSchedules: &[]model.ResetSchedule{exhaustedSchedule("sched-1", false)},
	}
	updated, err := s.UpdateSubscription(created.ID, updates, nil)
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}
	if updated.Status != "paused" {
		t.Fatalf("status = %q, want the explicitly chosen paused", updated.Status)
	}
}

func TestUpdateSubscriptionClearsPlanIDOnTypeSwitch(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(SubscriptionInput{
		Name: "阿里 Token Plan", Category: "官方订阅", Provider: "alibaba",
		SubscriptionType: "recurring", BillingCycle: "monthly", Price: 100,
		Status: "active", PlanID: "token-plan",
	}, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	updated, err := s.UpdateSubscription(created.ID, SubscriptionUpdates{
		SubscriptionType: stringPtr("one-time"),
	}, nil)
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}
	if updated.PlanID != "" {
		t.Fatalf("planId = %q, want cleared when switching to one-time (ADR-0005)", updated.PlanID)
	}
}

func TestUpdateSubscriptionRejectsDuplicateScheduleTypes(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(subscriptionInput("A"), nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	dupes := []model.ResetSchedule{
		exhaustedSchedule("sched-1", false),
		exhaustedSchedule("sched-2", false),
	}
	_, err = s.UpdateSubscription(created.ID, SubscriptionUpdates{ResetSchedules: &dupes}, nil)
	if err == nil || !strings.Contains(err.Error(), "Duplicate schedule type") {
		t.Fatalf("error = %v, want the duplicate-type guard", err)
	}
}

// ---------- categories ----------

func TestOpenSeedsDefaultCategories(t *testing.T) {
	s := openTestStore(t)
	categories, err := s.Categories()
	if err != nil {
		t.Fatalf("Categories: %v", err)
	}
	if !reflect.DeepEqual(categories, DefaultCategories) {
		t.Fatalf("categories = %#v, want %#v", categories, DefaultCategories)
	}
}

func TestAddCategoryIsIdempotent(t *testing.T) {
	s := openTestStore(t)
	first, err := s.AddCategory("图像生成")
	if err != nil {
		t.Fatalf("AddCategory: %v", err)
	}
	second, err := s.AddCategory("图像生成")
	if err != nil {
		t.Fatalf("AddCategory (again): %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("category list changed on repeat add: %#v vs %#v", first, second)
	}
	if got := len(first); got != len(DefaultCategories)+1 {
		t.Fatalf("categories = %#v, want one extra", first)
	}
}

func TestDeleteCategoryRefusesInUseCategory(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.CreateSubscription(SubscriptionInput{
		Name: "A", Category: "中转站", Price: 1, SubscriptionType: "one-time",
	}, nil); err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	_, err := s.DeleteCategory("中转站")
	if err == nil || err.Error() != "Cannot delete category with subscriptions" {
		t.Fatalf("error = %v, want the in-use guard", err)
	}

	categories, err := s.Categories()
	if err != nil {
		t.Fatalf("Categories: %v", err)
	}
	if !contains(categories, "中转站") {
		t.Fatalf("categories = %#v, want 中转站 kept", categories)
	}
}

func TestDeleteCategoryIgnoresUnknownName(t *testing.T) {
	s := openTestStore(t)
	categories, err := s.DeleteCategory("不存在")
	if err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
	if !reflect.DeepEqual(categories, DefaultCategories) {
		t.Fatalf("categories = %#v, want unchanged", categories)
	}
}

func TestDeleteCategoryRemovesUnusedCategory(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.AddCategory("图像生成"); err != nil {
		t.Fatalf("AddCategory: %v", err)
	}
	categories, err := s.DeleteCategory("图像生成")
	if err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
	if contains(categories, "图像生成") {
		t.Fatalf("categories = %#v, want 图像生成 removed", categories)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
