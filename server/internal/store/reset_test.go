package store

// Parity port of __tests__/db.test.ts (6 cases): reset-tick filtering and the
// schedule-exhaustion status transitions.

import (
	"testing"
	"time"

	"ai-subscriptions/internal/model"
)

var tickNow = time.Date(2024, 6, 1, 1, 0, 0, 0, time.UTC)

func openTickStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir()+"/tick.db", WithClock(func() time.Time { return tickNow }))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func scheduleFixture(overrides func(*model.ResetSchedule)) model.ResetSchedule {
	schedule := model.ResetSchedule{
		ID:            "sched-1",
		Enabled:       true,
		Type:          "monthly",
		NextResetTime: "2024-01-01T00:00:00Z",
		Exhausted:     false,
		CreatedAt:     "2024-01-01T00:00:00Z",
		UpdatedAt:     "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&schedule)
	}
	return schedule
}

func subscriptionFixture(overrides func(*model.Subscription)) model.Subscription {
	dayOfMonth := 15
	timeOfDay := "10:00"
	sub := model.Subscription{
		ID:               "sub-1",
		Name:             "Active Sub",
		Category:         "AI助手",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "active",
		ResetSchedules: []model.ResetSchedule{scheduleFixture(func(s *model.ResetSchedule) {
			s.DayOfMonth = &dayOfMonth
			s.TimeOfDay = timeOfDay
		})},
		CreatedAt: "2024-01-01T00:00:00Z",
		UpdatedAt: "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&sub)
	}
	return sub
}

func seedTickData(t *testing.T, s *Store, sub model.Subscription) {
	t.Helper()
	data := &model.SubscriptionData{
		Subscriptions: []model.Subscription{sub},
		Categories:    []string{},
		Tags:          []model.Tag{},
	}
	if err := s.WriteSubscriptionData(data); err != nil {
		t.Fatalf("WriteSubscriptionData: %v", err)
	}
}

// db.test.ts: "does NOT produce triggers for cancelled subscriptions".
func TestResetTickSkipsCancelledSubscriptions(t *testing.T) {
	s := openTickStore(t)
	seedTickData(t, s, subscriptionFixture(func(sub *model.Subscription) {
		sub.Name = "Cancelled Sub"
		sub.Status = "cancelled"
	}))

	triggers, err := s.ProcessResetTick()
	if err != nil {
		t.Fatalf("ProcessResetTick: %v", err)
	}
	if len(triggers) != 0 {
		t.Fatalf("triggers = %#v, want none", triggers)
	}
}

// db.test.ts: "does NOT produce triggers for disabled schedules".
func TestResetTickSkipsDisabledSchedules(t *testing.T) {
	s := openTickStore(t)
	seedTickData(t, s, subscriptionFixture(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{scheduleFixture(func(schedule *model.ResetSchedule) {
			schedule.Enabled = false
		})}
	}))

	triggers, err := s.ProcessResetTick()
	if err != nil {
		t.Fatalf("ProcessResetTick: %v", err)
	}
	if len(triggers) != 0 {
		t.Fatalf("triggers = %#v, want none", triggers)
	}
}

// db.test.ts: "does NOT produce triggers when schedule was not exhausted"
// — the schedule still advances.
func TestResetTickAdvancesWithoutTriggeringWhenNotExhausted(t *testing.T) {
	s := openTickStore(t)
	seedTickData(t, s, subscriptionFixture(nil))

	triggers, err := s.ProcessResetTick()
	if err != nil {
		t.Fatalf("ProcessResetTick: %v", err)
	}
	if len(triggers) != 0 {
		t.Fatalf("triggers = %#v, want none (schedule was already available)", triggers)
	}

	saved := mustSubscriptions(t, s)
	if len(saved) != 1 || len(saved[0].ResetSchedules) != 1 {
		t.Fatalf("saved subscriptions = %#v", saved)
	}
	next, err := time.Parse(time.RFC3339, saved[0].ResetSchedules[0].NextResetTime)
	if err != nil {
		t.Fatalf("parse nextResetTime %q: %v", saved[0].ResetSchedules[0].NextResetTime, err)
	}
	if !next.After(tickNow) {
		t.Fatalf("nextResetTime = %v, want after %v", next, tickNow)
	}
}

// db.test.ts: "produces a trigger when an exhausted schedule resets".
func TestResetTickTriggersAndClearsExhaustion(t *testing.T) {
	s := openTickStore(t)
	seedTickData(t, s, subscriptionFixture(func(sub *model.Subscription) {
		sub.ResetSchedules[0].Exhausted = true
	}))

	triggers, err := s.ProcessResetTick()
	if err != nil {
		t.Fatalf("ProcessResetTick: %v", err)
	}
	if len(triggers) != 1 {
		t.Fatalf("triggers = %#v, want 1", triggers)
	}
	if triggers[0].SubscriptionID != "sub-1" {
		t.Fatalf("trigger subscriptionId = %q, want sub-1", triggers[0].SubscriptionID)
	}
	if triggers[0].ScheduleType != "monthly" {
		t.Fatalf("trigger scheduleType = %q, want monthly", triggers[0].ScheduleType)
	}
	next, err := time.Parse(time.RFC3339, triggers[0].NextResetTime)
	if err != nil {
		t.Fatalf("parse trigger nextResetTime %q: %v", triggers[0].NextResetTime, err)
	}
	if !next.After(tickNow) {
		t.Fatalf("trigger nextResetTime = %v, want after %v", next, tickNow)
	}

	saved := mustSubscriptions(t, s)
	if saved[0].ResetSchedules[0].Exhausted {
		t.Fatal("schedule still exhausted after reset tick")
	}
	if saved[0].Status != "active" {
		t.Fatalf("status = %q, want active", saved[0].Status)
	}
}

// db.test.ts: "pauses an active subscription when a schedule is exhausted".
func TestToggleScheduleExhaustedPausesActiveSubscription(t *testing.T) {
	s := openTickStore(t)
	seedTickData(t, s, subscriptionFixture(nil))

	updated, err := s.ToggleScheduleExhausted("sub-1", "sched-1", true)
	if err != nil {
		t.Fatalf("ToggleScheduleExhausted: %v", err)
	}
	if updated == nil {
		t.Fatal("ToggleScheduleExhausted returned nil for an existing schedule")
	}
	if updated.Status != "paused" {
		t.Fatalf("status = %q, want paused", updated.Status)
	}
	if !updated.ResetSchedules[0].Exhausted {
		t.Fatal("schedule not marked exhausted")
	}
}

// db.test.ts: "restores active after an exhausted schedule is cleared".
func TestToggleScheduleExhaustedRestoresActiveStatus(t *testing.T) {
	s := openTickStore(t)
	seedTickData(t, s, subscriptionFixture(func(sub *model.Subscription) {
		sub.Status = "paused"
		sub.ResetSchedules[0].Exhausted = true
	}))

	updated, err := s.ToggleScheduleExhausted("sub-1", "sched-1", false)
	if err != nil {
		t.Fatalf("ToggleScheduleExhausted: %v", err)
	}
	if updated == nil || updated.Status != "active" {
		t.Fatalf("updated = %#v, want status active", updated)
	}
	if updated.ResetSchedules[0].Exhausted {
		t.Fatal("schedule still marked exhausted")
	}
}
