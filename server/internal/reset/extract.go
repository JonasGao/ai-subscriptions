package reset

import (
	"fmt"
	"time"
)

// Reverse-derivation helpers ported from lib/reset-schedule.ts
// (extractDayOfWeekFromDate / extractDayOfMonthFromDate /
// extractTimeOfDayFromDate, ADR-0016). Values are read off the given instant
// in the schedule's own timezone; the time of day is truncated to the minute.

// ExtractDayOfWeekFromDate returns the weekday in timezone, Sunday = 0
// (JS Date#getDay semantics).
func ExtractDayOfWeekFromDate(date time.Time, timezone string) int {
	return int(date.In(location(timezone)).Weekday())
}

// ExtractDayOfMonthFromDate returns the day of the month in timezone.
func ExtractDayOfMonthFromDate(date time.Time, timezone string) int {
	return date.In(location(timezone)).Day()
}

// ExtractTimeOfDayFromDate returns "HH:MM" in timezone (minute truncation).
func ExtractTimeOfDayFromDate(date time.Time, timezone string) string {
	local := date.In(location(timezone))
	return fmt.Sprintf("%02d:%02d", local.Hour(), local.Minute())
}
