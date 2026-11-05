package store

// Query-driven reset-time calibration (ADR-0014 / ADR-0016): after a
// successful usage query, reverse-derive weekly/monthly schedule config from
// the provider's resetTime, double-write nextResetTime with the API value and
// persist. Ported from lib/reset-alignment.ts.

import (
	"log"
	"time"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
	"ai-subscriptions/internal/reset"
)

type calibrationCandidate struct {
	subID        string
	scheduleID   string
	newResetTime string
	timeOfDay    string
	hasTimeOfDay bool
	dayOfWeek    *int
	dayOfMonth   *int
}

func skipCalibration(sub model.Subscription, reason string, schedulePart string) {
	if schedulePart != "" {
		log.Printf("[Scheduler] Reset-time calibration skipped for %s(%s) %s: %s", sub.Name, sub.ID, schedulePart, reason)
		return
	}
	log.Printf("[Scheduler] Reset-time calibration skipped for %s(%s): %s", sub.Name, sub.ID, reason)
}

// usageBucket maps a schedule type onto its usage result bucket. The names
// align 1:1 by design (ADR-0014); an unknown type has no bucket.
func usageBucket(scheduleType string, result providers.UsageResult) *providers.UsageWindow {
	switch scheduleType {
	case reset.FiveHour:
		return result.FiveHour
	case reset.Weekly:
		return result.Weekly
	case reset.Monthly:
		return result.Monthly
	default:
		return nil
	}
}

// computeCalibrationCandidates derives one candidate per enabled schedule of
// sub. Guards (missing bucket, null resetTime, invalid timestamp, non-future
// timestamp) only log and skip — the schedule is left untouched.
func computeCalibrationCandidates(sub model.Subscription, result providers.UsageResult, now time.Time) []calibrationCandidate {
	candidates := make([]calibrationCandidate, 0)
	for _, schedule := range sub.ResetSchedules {
		if !schedule.Enabled {
			continue
		}
		bucket := usageBucket(schedule.Type, result)
		if bucket == nil || bucket.ResetTime == nil {
			skipCalibration(sub, "no resetTime", schedule.Type)
			continue
		}
		parsed, err := time.Parse(time.RFC3339, *bucket.ResetTime)
		if err != nil {
			skipCalibration(sub, "invalid timestamp", schedule.Type)
			continue
		}
		if !parsed.After(now) {
			skipCalibration(sub, "resetTime <= now", schedule.Type)
			continue
		}

		candidate := calibrationCandidate{
			subID:        sub.ID,
			scheduleID:   schedule.ID,
			newResetTime: *bucket.ResetTime,
		}
		switch schedule.Type {
		case reset.Weekly:
			dayOfWeek := reset.ExtractDayOfWeekFromDate(parsed, schedule.Timezone)
			candidate.dayOfWeek = &dayOfWeek
			candidate.timeOfDay = reset.ExtractTimeOfDayFromDate(parsed, schedule.Timezone)
			candidate.hasTimeOfDay = true
		case reset.Monthly:
			dayOfMonth := reset.ExtractDayOfMonthFromDate(parsed, schedule.Timezone)
			candidate.dayOfMonth = &dayOfMonth
			candidate.timeOfDay = reset.ExtractTimeOfDayFromDate(parsed, schedule.Timezone)
			candidate.hasTimeOfDay = true
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}

// CalibrateSubscriptionFromUsage calibrates one subscription's schedules from
// an already-fetched UsageResult and persists. The caller already paid for the
// fetch, so no second request is made here. Returns the freshest copy of the
// subscription (whether or not anything changed), or nil if it is gone.
func (s *Store) CalibrateSubscriptionFromUsage(subscriptionID string, result providers.UsageResult) (*model.Subscription, error) {
	subs, err := s.Subscriptions()
	if err != nil {
		return nil, err
	}
	var sub *model.Subscription
	for i := range subs {
		if subs[i].ID == subscriptionID {
			sub = &subs[i]
			break
		}
	}
	if sub == nil {
		log.Printf("[Scheduler] Reset-time calibration skipped for (%s): subscription not found", subscriptionID)
		return nil, nil
	}

	candidates := computeCalibrationCandidates(*sub, result, s.now())
	if len(candidates) > 0 {
		if err := s.applyCalibrationCandidates(candidates); err != nil {
			return nil, err
		}
	}
	return s.SubscriptionByID(subscriptionID)
}

// applyCalibrationCandidates applies every candidate in one read-modify-write
// pass. Each candidate is re-located by subID+scheduleID in freshly-read data;
// a subscription or schedule deleted (or a schedule disabled) since the query
// is skipped with a log line. Unchanged values are logged but never written.
func (s *Store) applyCalibrationCandidates(candidates []calibrationCandidate) error {
	nowISO := s.nowISO()
	return s.updateSubscriptionData(func(data *model.SubscriptionData) (bool, error) {
		anyWritten := false
		for _, candidate := range candidates {
			subIndex := -1
			for i := range data.Subscriptions {
				if data.Subscriptions[i].ID == candidate.subID {
					subIndex = i
					break
				}
			}
			if subIndex == -1 {
				log.Printf("[Scheduler] Reset-time calibration skipped for (%s): subscription deleted", candidate.subID)
				continue
			}
			sub := &data.Subscriptions[subIndex]

			scheduleIndex := -1
			for i := range sub.ResetSchedules {
				if sub.ResetSchedules[i].ID == candidate.scheduleID {
					scheduleIndex = i
					break
				}
			}
			if scheduleIndex == -1 {
				log.Printf("[Scheduler] Reset-time calibration skipped for %s(%s) %s: schedule deleted", sub.Name, sub.ID, candidate.scheduleID)
				continue
			}
			schedule := &sub.ResetSchedules[scheduleIndex]
			if !schedule.Enabled {
				skipCalibration(*sub, "schedule disabled", schedule.Type)
				continue
			}

			timeOfDayUnchanged := schedule.TimeOfDay == ""
			if candidate.hasTimeOfDay {
				timeOfDayUnchanged = schedule.TimeOfDay == candidate.timeOfDay
			}
			unchanged := schedule.NextResetTime == candidate.newResetTime &&
				timeOfDayUnchanged &&
				equalIntPtr(schedule.DayOfWeek, candidate.dayOfWeek) &&
				equalIntPtr(schedule.DayOfMonth, candidate.dayOfMonth)
			if unchanged {
				log.Printf("[Scheduler] Reset-time calibrated for %s(%s) %s: %s → %s", sub.Name, sub.ID, schedule.Type, schedule.NextResetTime, candidate.newResetTime)
				continue
			}

			oldResetTime := schedule.NextResetTime
			schedule.NextResetTime = candidate.newResetTime
			if candidate.hasTimeOfDay {
				schedule.TimeOfDay = candidate.timeOfDay
			}
			if candidate.dayOfWeek != nil {
				value := *candidate.dayOfWeek
				schedule.DayOfWeek = &value
			}
			if candidate.dayOfMonth != nil {
				value := *candidate.dayOfMonth
				schedule.DayOfMonth = &value
			}
			schedule.UpdatedAt = nowISO
			sub.UpdatedAt = nowISO
			anyWritten = true
			log.Printf("[Scheduler] Reset-time calibrated for %s(%s) %s: %s → %s", sub.Name, sub.ID, schedule.Type, oldResetTime, candidate.newResetTime)
		}
		return anyWritten, nil
	})
}

func equalIntPtr(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
