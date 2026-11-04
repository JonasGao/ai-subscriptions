package status

// Parity port of __tests__/status-policy.test.ts (3 cases). The Go policy
// shipped with the storage ticket; this file pins the old stack's observable
// resolve/derive/explain semantics.

import "testing"

func TestResolveKeepsCancelledStatusAndExplainsItAsManual(t *testing.T) {
	got := Resolve(Cancelled, nil)

	if got.Status != Cancelled {
		t.Fatalf("status = %q, want %q", got.Status, Cancelled)
	}
	if got.Reason.Kind != "manual-cancelled" {
		t.Fatalf("reason = %#v, want manual-cancelled", got.Reason)
	}
	if len(got.Reason.ScheduleIDs) != 0 {
		t.Fatalf("scheduleIds = %#v, want none", got.Reason.ScheduleIDs)
	}
}

func TestDerivePausesFromEnabledExhaustedSchedules(t *testing.T) {
	// Only enabled schedules count; a disabled exhausted schedule must be
	// ignored by both the derive and the explanation.
	schedules := []Schedule{
		{ID: "schedule-1", Enabled: true, Exhausted: true},
		{ID: "schedule-disabled", Enabled: false, Exhausted: true},
	}

	if got := Derive(Active, schedules); got != Paused {
		t.Fatalf("deriveStatus = %q, want %q", got, Paused)
	}

	got := Resolve(Active, schedules)
	if got.Reason.Kind != "schedule-exhausted" {
		t.Fatalf("reason = %#v, want schedule-exhausted", got.Reason)
	}
	if len(got.Reason.ScheduleIDs) != 1 || got.Reason.ScheduleIDs[0] != "schedule-1" {
		t.Fatalf("scheduleIds = %#v, want [schedule-1]", got.Reason.ScheduleIDs)
	}
}

func TestResolveRestoresActiveWhenNoEnabledScheduleIsExhausted(t *testing.T) {
	// A manually paused subscription with no exhausted schedule becomes
	// effective-active; the reason still records the manual pause.
	schedules := []Schedule{{ID: "schedule-1", Enabled: true, Exhausted: false}}

	got := Resolve(Paused, schedules)
	if got.Status != Active {
		t.Fatalf("status = %q, want %q", got.Status, Active)
	}
	if got.Reason.Kind != "manual-paused" {
		t.Fatalf("reason = %#v, want manual-paused", got.Reason)
	}
}
