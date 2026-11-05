package store

import (
	"fmt"
	"time"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/reset"
	"ai-subscriptions/internal/status"
)

// Schedule write errors (lib/db.ts messages, surfaced verbatim by the API).
// The duplicate-type guard itself lives in assertUniqueScheduleTypes
// (subscription_writes.go) and is reused by every write path.

// ResetScheduleInput is the writable part of a new schedule (addResetSchedule).
type ResetScheduleInput struct {
	Type       string
	Enabled    *bool
	TimeOfDay  string
	Timezone   string
	DayOfWeek  *int
	DayOfMonth *int
	// NextResetTime overrides the computed first reset. The UI uses it for the
	// five-hour offset/direct shortcuts, which pin an explicit instant.
	NextResetTime string
}

// AddResetSchedule ports lib/db.ts addResetSchedule: create one schedule of a
// type the subscription does not carry yet, computing its first nextResetTime.
// A missing subscription returns (nil, nil), exactly like the old stack.
func (s *Store) AddResetSchedule(subscriptionID string, input ResetScheduleInput) (*model.ResetSchedule, error) {
	spec := reset.Spec{
		Type:       input.Type,
		TimeOfDay:  input.TimeOfDay,
		Timezone:   input.Timezone,
		DayOfWeek:  input.DayOfWeek,
		DayOfMonth: input.DayOfMonth,
	}
	if err := reset.Validate(spec); err != nil {
		return nil, err
	}

	now := s.now()
	nextResetTime := input.NextResetTime
	if nextResetTime == "" {
		computed, err := reset.NextResetTime(spec, now, nil)
		if err != nil {
			return nil, err
		}
		nextResetTime = model.FormatTimestamp(computed)
	}

	created := model.ResetSchedule{
		ID:            newID(),
		Enabled:       input.Enabled == nil || *input.Enabled,
		Type:          spec.Type,
		TimeOfDay:     spec.TimeOfDay,
		Timezone:      spec.Timezone,
		DayOfWeek:     spec.DayOfWeek,
		DayOfMonth:    spec.DayOfMonth,
		NextResetTime: nextResetTime,
		Exhausted:     false,
		CreatedAt:     model.FormatTimestamp(now),
		UpdatedAt:     model.FormatTimestamp(now),
	}

	var added *model.ResetSchedule
	err := s.UpdateSubscriptionData(func(data *model.SubscriptionData) error {
		for i := range data.Subscriptions {
			sub := &data.Subscriptions[i]
			if sub.ID != subscriptionID {
				continue
			}
			for _, existing := range sub.ResetSchedules {
				if existing.Type == created.Type {
					return errScheduleTypeExists(created.Type)
				}
			}
			sub.ResetSchedules = append(sub.ResetSchedules, created)
			sub.UpdatedAt = model.FormatTimestamp(now)
			added = &created
			return nil
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return added, nil
}

func errScheduleTypeExists(scheduleType string) error {
	return fmt.Errorf("Schedule type %q already exists for this subscription", scheduleType)
}

// ProcessResetTick ports lib/db.ts processResetTick.
//
// It fires every enabled schedule whose nextResetTime is due: clears the
// exhausted flag, advances nextResetTime from its previous anchor, and derives
// the subscription status. A trigger is emitted only when the schedule had been
// exhausted — an already-available schedule just advances silently (ADR-0007).
func (s *Store) ProcessResetTick() ([]model.ResetTickTrigger, error) {
	now := s.now()
	nowISO := model.FormatTimestamp(now)
	triggers := make([]model.ResetTickTrigger, 0)

	anyFired := false
	err := s.updateSubscriptionData(func(data *model.SubscriptionData) (bool, error) {
		for i := range data.Subscriptions {
			sub := &data.Subscriptions[i]
			if sub.Status == status.Cancelled {
				continue
			}
			if len(sub.ResetSchedules) == 0 {
				continue
			}

			subFired := false
			for j := range sub.ResetSchedules {
				schedule := &sub.ResetSchedules[j]
				if !schedule.Enabled {
					continue
				}
				nextReset, err := time.Parse(time.RFC3339, schedule.NextResetTime)
				if err != nil {
					continue
				}
				if now.Before(nextReset) {
					continue
				}

				wasExhausted := schedule.Exhausted
				schedule.Exhausted = false

				next, err := reset.NextResetTime(resetSpec(*schedule), now, &nextReset)
				if err != nil {
					// Invalid configuration: leave the schedule untouched and
					// move on, matching the old stack's warn-and-continue.
					continue
				}
				schedule.NextResetTime = model.FormatTimestamp(next)
				schedule.UpdatedAt = nowISO
				subFired = true
				anyFired = true

				if wasExhausted {
					triggers = append(triggers, model.ResetTickTrigger{
						SubscriptionID: sub.ID,
						ScheduleType:   schedule.Type,
						NextResetTime:  schedule.NextResetTime,
					})
				}
			}

			if subFired {
				if derived := deriveStatus(*sub); derived != sub.Status {
					sub.Status = derived
					sub.UpdatedAt = nowISO
				}
			}
		}
		return anyFired, nil
	})
	if err != nil {
		return nil, err
	}
	return triggers, nil
}

// ToggleScheduleExhausted ports lib/db.ts toggleScheduleExhausted: flip the
// flag, re-derive the subscription status, and persist both.
func (s *Store) ToggleScheduleExhausted(subscriptionID, scheduleID string, exhausted bool) (*model.Subscription, error) {
	nowISO := s.nowISO()
	var updated *model.Subscription

	err := s.updateSubscriptionData(func(data *model.SubscriptionData) (bool, error) {
		for i := range data.Subscriptions {
			sub := &data.Subscriptions[i]
			if sub.ID != subscriptionID {
				continue
			}
			for j := range sub.ResetSchedules {
				if sub.ResetSchedules[j].ID != scheduleID {
					continue
				}
				sub.ResetSchedules[j].Exhausted = exhausted
				sub.ResetSchedules[j].UpdatedAt = nowISO
				sub.Status = deriveStatus(*sub)
				sub.UpdatedAt = nowISO
				copy := *sub
				updated = &copy
				return true, nil
			}
			return false, nil
		}
		return false, nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func resetSpec(schedule model.ResetSchedule) reset.Spec {
	return reset.Spec{
		Type:       schedule.Type,
		TimeOfDay:  schedule.TimeOfDay,
		Timezone:   schedule.Timezone,
		DayOfWeek:  schedule.DayOfWeek,
		DayOfMonth: schedule.DayOfMonth,
	}
}

func deriveStatus(sub model.Subscription) string {
	schedules := make([]status.Schedule, len(sub.ResetSchedules))
	for i, schedule := range sub.ResetSchedules {
		schedules[i] = status.Schedule{
			ID:        schedule.ID,
			Enabled:   schedule.Enabled,
			Exhausted: schedule.Exhausted,
		}
	}
	return status.Derive(sub.Status, schedules)
}
