package store

// Parity port of __tests__/reset-schedule-uniqueness.test.ts (10 cases):
// schedule uniqueness on the write paths plus the load-time de-duplication
// that keeps the earliest-created schedule per type.
//
// ADR-0017 deviation: the old stack rewrote subscriptions.json on every read
// that repaired duplicates. SQLite reads are read-only, so the repair is
// applied to the returned document and the next write transaction (which
// re-serialises the deduplicated set) persists it — locked by the final case.

import (
	"testing"

	"ai-subscriptions/internal/model"
)

func uniqueSchedule(id, scheduleType, createdAt string) model.ResetSchedule {
	return model.ResetSchedule{
		ID:            id,
		Enabled:       true,
		Type:          scheduleType,
		NextResetTime: "2024-01-01T00:00:00.000Z",
		Exhausted:     false,
		CreatedAt:     createdAt,
		UpdatedAt:     createdAt,
	}
}

// createSubscription: "allows creating a subscription with unique schedule
// types".
func TestCreateSubscriptionAllowsUniqueScheduleTypes(t *testing.T) {
	s := openTestStore(t)
	input := subscriptionInput("Unique")
	input.ResetSchedules = []model.ResetSchedule{
		uniqueSchedule("s1", "fiveHour", "2024-01-01T00:00:00.000Z"),
		uniqueSchedule("s2", "weekly", "2024-01-01T00:00:00.000Z"),
		uniqueSchedule("s3", "monthly", "2024-01-01T00:00:00.000Z"),
	}

	created, err := s.CreateSubscription(input, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	if len(created.ResetSchedules) != 3 {
		t.Fatalf("resetSchedules = %#v, want 3", created.ResetSchedules)
	}
}

// createSubscription: "rejects duplicate schedule types".
func TestCreateSubscriptionRejectsDuplicateScheduleTypes(t *testing.T) {
	s := openTestStore(t)
	input := subscriptionInput("Duplicates")
	input.ResetSchedules = []model.ResetSchedule{
		uniqueSchedule("s1", "weekly", "2024-01-01T00:00:00.000Z"),
		uniqueSchedule("s2", "weekly", "2024-01-01T00:00:00.000Z"),
	}

	_, err := s.CreateSubscription(input, nil)
	if err == nil || err.Error() != `Duplicate schedule type "weekly" — each type is allowed at most once` {
		t.Fatalf("error = %v, want the duplicate-type guard", err)
	}
	if subs, _ := s.Subscriptions(); len(subs) != 0 {
		t.Fatalf("subscriptions = %#v, want none written", subs)
	}
}

// updateSubscription: "allows updating with unique schedule types".
func TestUpdateSubscriptionAllowsUniqueScheduleTypes(t *testing.T) {
	s := openTestStore(t)
	created, err := s.CreateSubscription(subscriptionInput("UpdateUnique"), nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	schedules := []model.ResetSchedule{
		uniqueSchedule("s1", "fiveHour", "2024-01-01T00:00:00.000Z"),
		uniqueSchedule("s2", "monthly", "2024-01-01T00:00:00.000Z"),
	}
	updated, err := s.UpdateSubscription(created.ID, SubscriptionUpdates{ResetSchedules: &schedules}, nil)
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}
	if len(updated.ResetSchedules) != 2 {
		t.Fatalf("resetSchedules = %#v, want 2", updated.ResetSchedules)
	}
}

// addResetSchedule: "allows adding a new schedule type".
func TestAddResetScheduleAllowsNewType(t *testing.T) {
	s := openTestStore(t)
	input := subscriptionInput("AddSchedule")
	input.ResetSchedules = []model.ResetSchedule{
		uniqueSchedule("s1", "fiveHour", "2024-01-01T00:00:00.000Z"),
	}
	created, err := s.CreateSubscription(input, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	dayOfWeek := 1
	schedule, err := s.AddResetSchedule(created.ID, ResetScheduleInput{
		Type:      "weekly",
		Enabled:   boolPtr(true),
		DayOfWeek: &dayOfWeek,
		TimeOfDay: "10:00",
	})
	if err != nil {
		t.Fatalf("AddResetSchedule: %v", err)
	}
	if schedule == nil || schedule.Type != "weekly" {
		t.Fatalf("schedule = %#v, want a weekly schedule", schedule)
	}
	if schedule.NextResetTime == "" {
		t.Fatal("AddResetSchedule must compute nextResetTime")
	}

	saved, err := s.SubscriptionByID(created.ID)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if len(saved.ResetSchedules) != 2 {
		t.Fatalf("resetSchedules = %#v, want 2", saved.ResetSchedules)
	}
}

// addResetSchedule: "rejects adding a duplicate schedule type".
func TestAddResetScheduleRejectsDuplicateType(t *testing.T) {
	s := openTestStore(t)
	input := subscriptionInput("AddDuplicate")
	input.ResetSchedules = []model.ResetSchedule{
		uniqueSchedule("s1", "fiveHour", "2024-01-01T00:00:00.000Z"),
	}
	created, err := s.CreateSubscription(input, nil)
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}

	_, err = s.AddResetSchedule(created.ID, ResetScheduleInput{Type: "fiveHour", Enabled: boolPtr(true)})
	if err == nil || err.Error() != `Schedule type "fiveHour" already exists for this subscription` {
		t.Fatalf("error = %v, want the per-subscription duplicate guard", err)
	}
}

// data migration: "deduplicates schedules keeping earliest createdAt".
//
// ADR-0017: SQLite carries UNIQUE (subscription_id, type), so a duplicate can
// only arrive through the legacy JSON import — that is where the old read-time
// repair now runs (and it persists the deduplicated rows for good).
func TestLoadDeduplicatesSchedulesKeepingEarliestCreatedAt(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", dedupeFixture([]any{
		legacyScheduleJSON("s1", "weekly", "2024-01-02T00:00:00.000Z", false),
		legacyScheduleJSON("s2", "weekly", "2024-01-01T00:00:00.000Z", false),
		legacyScheduleJSON("s3", "weekly", "2024-01-03T00:00:00.000Z", false),
	}, "active"))

	s := openStoreIn(t, dir)
	saved, err := s.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	if len(saved[0].ResetSchedules) != 1 {
		t.Fatalf("resetSchedules = %#v, want 1", saved[0].ResetSchedules)
	}
	if saved[0].ResetSchedules[0].ID != "s2" {
		t.Fatalf("surviving id = %q, want s2 (earliest createdAt)", saved[0].ResetSchedules[0].ID)
	}
	if saved[0].ResetSchedules[0].CreatedAt != "2024-01-01T00:00:00.000Z" {
		t.Fatalf("createdAt = %q", saved[0].ResetSchedules[0].CreatedAt)
	}
}

// data migration: "deduplicates multiple types independently".
func TestLoadDeduplicatesMultipleTypesIndependently(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", dedupeFixture([]any{
		legacyScheduleJSON("s1", "fiveHour", "2024-01-01T00:00:00.000Z", false),
		legacyScheduleJSON("s2", "fiveHour", "2024-01-02T00:00:00.000Z", false),
		legacyScheduleJSON("s3", "monthly", "2024-01-03T00:00:00.000Z", false),
		legacyScheduleJSON("s4", "monthly", "2024-01-01T00:00:00.000Z", false),
	}, "active"))

	s := openStoreIn(t, dir)
	saved, err := s.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	if len(saved[0].ResetSchedules) != 2 {
		t.Fatalf("resetSchedules = %#v, want 2", saved[0].ResetSchedules)
	}
	byType := map[string]string{}
	for _, schedule := range saved[0].ResetSchedules {
		byType[schedule.Type] = schedule.ID
	}
	if byType["fiveHour"] != "s1" {
		t.Fatalf("fiveHour survivor = %q, want s1", byType["fiveHour"])
	}
	if byType["monthly"] != "s4" {
		t.Fatalf("monthly survivor = %q, want s4", byType["monthly"])
	}
}

// data migration: "recomputes subscription status when a duplicate is dropped".
func TestLoadRecomputesStatusWhenDuplicateDropped(t *testing.T) {
	dir := t.TempDir()
	// The dropped (newer) schedule is the exhausted one that drove the stored
	// "paused" status; the surviving earliest one is not exhausted.
	writeJSONFile(t, dir, "subscriptions.json", dedupeFixture([]any{
		legacyScheduleJSON("s1", "weekly", "2024-01-01T00:00:00.000Z", false),
		legacyScheduleJSON("s2", "weekly", "2024-01-02T00:00:00.000Z", true),
	}, "paused"))

	s := openStoreIn(t, dir)
	saved, err := s.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	if len(saved[0].ResetSchedules) != 1 || saved[0].ResetSchedules[0].ID != "s1" {
		t.Fatalf("resetSchedules = %#v, want [s1]", saved[0].ResetSchedules)
	}
	if saved[0].ResetSchedules[0].Exhausted {
		t.Fatal("surviving schedule should not be exhausted")
	}
	if saved[0].Status != "active" {
		t.Fatalf("status = %q, want active", saved[0].Status)
	}
}

// data migration: "writes deduplicated data back to file" — the imported
// database stores exactly the surviving row, so the repair is persisted.
func TestLoadPersistsDeduplicatedSchedules(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, dir, "subscriptions.json", dedupeFixture([]any{
		legacyScheduleJSON("s1", "weekly", "2024-01-02T00:00:00.000Z", false),
		legacyScheduleJSON("s2", "weekly", "2024-01-01T00:00:00.000Z", false),
	}, "active"))

	s := openStoreIn(t, dir)
	var rows int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM reset_schedules").Scan(&rows); err != nil {
		t.Fatalf("count schedules: %v", err)
	}
	if rows != 1 {
		t.Fatalf("persisted reset schedule rows = %d, want 1", rows)
	}
	var surviving string
	if err := s.db.QueryRow("SELECT id FROM reset_schedules").Scan(&surviving); err != nil {
		t.Fatalf("select surviving schedule: %v", err)
	}
	if surviving != "s2" {
		t.Fatalf("surviving row = %q, want s2", surviving)
	}
}

func legacyScheduleJSON(id, scheduleType, createdAt string, exhausted bool) map[string]any {
	dayOfWeek := 1
	dayOfMonth := 15
	schedule := map[string]any{
		"id":            id,
		"enabled":       true,
		"type":          scheduleType,
		"nextResetTime": "2024-01-01T00:00:00.000Z",
		"exhausted":     exhausted,
		"createdAt":     createdAt,
		"updatedAt":     createdAt,
	}
	switch scheduleType {
	case "weekly":
		schedule["dayOfWeek"] = dayOfWeek
		schedule["timeOfDay"] = "10:00"
	case "monthly":
		schedule["dayOfMonth"] = dayOfMonth
		schedule["timeOfDay"] = "10:00"
	}
	return schedule
}

func dedupeFixture(schedules []any, status string) map[string]any {
	return map[string]any{
		"subscriptions": []any{map[string]any{
			"id":               "sub-1",
			"name":             "Test Sub",
			"category":         "官方订阅",
			"provider":         "openai",
			"subscriptionType": "recurring",
			"billingCycle":     "monthly",
			"price":            20,
			"status":           status,
			"resetSchedules":   schedules,
			"createdAt":        "2024-01-01T00:00:00.000Z",
			"updatedAt":        "2024-01-01T00:00:00.000Z",
		}},
		"categories": []string{"官方订阅"},
	}
}
