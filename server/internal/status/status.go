// Package status ports lib/status-policy.ts: the single policy that derives a
// subscription's visible status from its persisted status and reset schedules.
package status

// Subscription status values (lib/types.ts SubscriptionStatus).
const (
	Active    = "active"
	Paused    = "paused"
	Cancelled = "cancelled"
)

// EffectiveStatusReason mirrors the old stack's discriminated union.
type EffectiveStatusReason struct {
	Kind        string   // "manual-cancelled" | "schedule-exhausted" | "available" | "manual-paused"
	ScheduleIDs []string // only for kind "schedule-exhausted"
}

// Schedule is the minimal view of a reset schedule this policy needs.
type Schedule struct {
	ID        string
	Enabled   bool
	Exhausted bool
}

// ResolvedStatus is the outcome of resolveStatus.
type ResolvedStatus struct {
	Status string
	Reason EffectiveStatusReason
}

// Resolve derives the effective status.
//
// Order matters (ported verbatim): an explicitly cancelled subscription stays
// cancelled; otherwise any enabled exhausted schedule pauses it; otherwise it
// is active, remembering that a manual pause is the reason when applicable.
func Resolve(persistedStatus string, schedules []Schedule) ResolvedStatus {
	enabled := make([]Schedule, 0, len(schedules))
	for _, schedule := range schedules {
		if schedule.Enabled {
			enabled = append(enabled, schedule)
		}
	}

	exhausted := make([]Schedule, 0, len(enabled))
	for _, schedule := range enabled {
		if schedule.Exhausted {
			exhausted = append(exhausted, schedule)
		}
	}

	if persistedStatus == Cancelled {
		return ResolvedStatus{
			Status: Cancelled,
			Reason: EffectiveStatusReason{Kind: "manual-cancelled"},
		}
	}

	if len(exhausted) > 0 {
		ids := make([]string, len(exhausted))
		for i, schedule := range exhausted {
			ids[i] = schedule.ID
		}
		return ResolvedStatus{
			Status: Paused,
			Reason: EffectiveStatusReason{Kind: "schedule-exhausted", ScheduleIDs: ids},
		}
	}

	kind := "available"
	if persistedStatus == Paused {
		kind = "manual-paused"
	}
	return ResolvedStatus{Status: Active, Reason: EffectiveStatusReason{Kind: kind}}
}

// Derive returns just the status (deriveStatus in lib/status-policy.ts).
func Derive(persistedStatus string, schedules []Schedule) string {
	return Resolve(persistedStatus, schedules).Status
}
