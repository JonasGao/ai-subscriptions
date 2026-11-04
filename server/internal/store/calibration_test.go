package store

// Parity port of the `calibrateSubscriptionFromUsage` describe block of
// __tests__/reset-alignment.test.ts (3 cases). The apply-side guards shared
// with the scheduler entry point are exercised from
// internal/calibration/calibration_test.go.

import (
	"testing"
	"time"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
)

var calibrationNow = time.Date(2024, 6, 1, 1, 0, 0, 0, time.UTC)

func openCalibrationStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir()+"/calibration.db", WithClock(func() time.Time { return calibrationNow }))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func intPtr(value int) *int { return &value }

func usageWindow(reset string) *providers.UsageWindow {
	return &providers.UsageWindow{Limit: "100", Used: "0", Remaining: "100", ResetTime: strPtr(reset)}
}

func monthlyUsage(reset string) providers.UsageResult {
	return providers.UsageResult{Provider: "test-provider", Monthly: usageWindow(reset)}
}

func seedCalibrationSubscription(t *testing.T, s *Store, schedule model.ResetSchedule) {
	t.Helper()
	sub := subscriptionFixture(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{schedule}
	})
	seedTickData(t, s, sub)
}

// Old case: "calibrates, persists, and returns the updated subscription".
func TestCalibrateSubscriptionFromUsagePersistsAndReturns(t *testing.T) {
	s := openCalibrationStore(t)
	seedCalibrationSubscription(t, s, model.ResetSchedule{
		ID:            "sched-monthly",
		Enabled:       true,
		Type:          "monthly",
		Timezone:      "UTC",
		DayOfMonth:    intPtr(1),
		TimeOfDay:     "00:00",
		NextResetTime: "2024-01-01T00:00:00Z",
		CreatedAt:     "2024-01-01T00:00:00Z",
		UpdatedAt:     "2024-01-01T00:00:00Z",
	})

	const newReset = "2099-07-15T12:00:00Z"
	updated, err := s.CalibrateSubscriptionFromUsage("sub-1", monthlyUsage(newReset))
	if err != nil {
		t.Fatalf("CalibrateSubscriptionFromUsage: %v", err)
	}
	if updated == nil {
		t.Fatal("updated = nil, want the calibrated subscription")
	}

	schedule := updated.ResetSchedules[0]
	if schedule.NextResetTime != newReset {
		t.Errorf("nextResetTime = %q, want %q", schedule.NextResetTime, newReset)
	}
	if schedule.DayOfMonth == nil || *schedule.DayOfMonth != 15 {
		t.Errorf("dayOfMonth = %v, want 15", schedule.DayOfMonth)
	}
	if schedule.TimeOfDay != "12:00" {
		t.Errorf("timeOfDay = %q, want 12:00", schedule.TimeOfDay)
	}

	saved, err := s.SubscriptionByID("sub-1")
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.ResetSchedules[0].NextResetTime != newReset {
		t.Errorf("persisted nextResetTime = %q, want %q", saved.ResetSchedules[0].NextResetTime, newReset)
	}
	if saved.ResetSchedules[0].DayOfMonth == nil || *saved.ResetSchedules[0].DayOfMonth != 15 {
		t.Errorf("persisted dayOfMonth = %v, want 15", saved.ResetSchedules[0].DayOfMonth)
	}
}

// Old case: "returns null when the subscription does not exist".
func TestCalibrateSubscriptionFromUsageMissingSubscription(t *testing.T) {
	s := openCalibrationStore(t)

	updated, err := s.CalibrateSubscriptionFromUsage("missing-sub", monthlyUsage("2099-12-31T23:59:59Z"))
	if err != nil {
		t.Fatalf("CalibrateSubscriptionFromUsage: %v", err)
	}
	if updated != nil {
		t.Fatalf("updated = %#v, want nil", updated)
	}
}

// Old case: "returns the subscription unchanged (no write) when no bucket has
// resetTime". The clock-fixed updatedAt is the write detector: a real write
// would bump it to calibrationNow.
func TestCalibrateSubscriptionFromUsageNoBucketLeavesDataUnchanged(t *testing.T) {
	s := openCalibrationStore(t)
	seedCalibrationSubscription(t, s, model.ResetSchedule{
		ID:            "sched-monthly",
		Enabled:       true,
		Type:          "monthly",
		NextResetTime: "2024-01-01T00:00:00Z",
		CreatedAt:     "2024-01-01T00:00:00Z",
		UpdatedAt:     "2024-01-01T00:00:00Z",
	})

	updated, err := s.CalibrateSubscriptionFromUsage("sub-1", providers.UsageResult{Provider: "test-provider"})
	if err != nil {
		t.Fatalf("CalibrateSubscriptionFromUsage: %v", err)
	}
	if updated == nil {
		t.Fatal("updated = nil, want the unchanged subscription")
	}
	if updated.ResetSchedules[0].NextResetTime != "2024-01-01T00:00:00Z" {
		t.Errorf("nextResetTime = %q, want original", updated.ResetSchedules[0].NextResetTime)
	}
	if updated.UpdatedAt != "2024-01-01T00:00:00Z" {
		t.Errorf("updatedAt = %q, want original (no write)", updated.UpdatedAt)
	}
}
