// Package reset ports the reset-time arithmetic from lib/reset-schedule.ts.
//
// Only the pieces the storage-layer reset tick needs live here for now; the
// remaining helpers (offset-based creation, calibration extraction) are
// ported in the reset-schedule ticket.
package reset

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	// Embedded IANA database keeps timezone-aware schedules working in the
	// static, distroless deployment (ADR-0018 single binary, no cgo).
	_ "time/tzdata"
)

// Schedule types (lib/types.ts ResetScheduleType).
const (
	FiveHour = "fiveHour"
	Weekly   = "weekly"
	Monthly  = "monthly"
)

// ValidTypes are the supported schedule types in display order.
var ValidTypes = []string{FiveHour, Weekly, Monthly}

// Duration is a parsed offset such as "3d 5h 44m" (parseDurationString).
type Duration struct {
	Days    int
	Hours   int
	Minutes int
}

// TotalMinutes returns the offset in whole minutes.
func (d Duration) TotalMinutes() int {
	return d.Days*24*60 + d.Hours*60 + d.Minutes
}

// ParseDuration parses an offset string like "3d 5h 44m" (parseDurationString).
//
// Whitespace is ignored and the unit letters are case-insensitive. A value
// with no components, or with hours >= 24 / minutes >= 60, is rejected — the
// old stack treated those as malformed rather than normalizing them.
func ParseDuration(value string) (Duration, bool) {
	cleaned := strings.ToLower(strings.Join(strings.Fields(value), ""))

	days, hasDays := leadingNumber(cleaned, "d")
	hours, hasHours := leadingNumber(cleaned, "h")
	minutes, hasMinutes := leadingNumber(cleaned, "m")

	if !hasDays && !hasHours && !hasMinutes {
		return Duration{}, false
	}
	duration := Duration{Days: days, Hours: hours, Minutes: minutes}
	if duration.Days == 0 && duration.Hours == 0 && duration.Minutes == 0 {
		return Duration{}, false
	}
	if duration.Hours > 23 || duration.Minutes > 59 {
		return Duration{}, false
	}
	return duration, true
}

// leadingNumber extracts the digits immediately preceding unit (first match),
// the same first-occurrence behaviour as the old regular expressions.
func leadingNumber(value, unit string) (int, bool) {
	index := strings.Index(value, unit)
	if index <= 0 {
		return 0, false
	}
	start := index
	for start > 0 && value[start-1] >= '0' && value[start-1] <= '9' {
		start--
	}
	if start == index {
		return 0, false
	}
	number, err := strconv.Atoi(value[start:index])
	if err != nil {
		return 0, false
	}
	return number, true
}

// FormatDuration renders a parsed offset the way the old UI did ("3d 5h 44m",
// or "0m" when every component is zero).
func FormatDuration(duration Duration) string {
	parts := make([]string, 0, 3)
	if duration.Days > 0 {
		parts = append(parts, strconv.Itoa(duration.Days)+"d")
	}
	if duration.Hours > 0 {
		parts = append(parts, strconv.Itoa(duration.Hours)+"h")
	}
	if duration.Minutes > 0 {
		parts = append(parts, strconv.Itoa(duration.Minutes)+"m")
	}
	if len(parts) == 0 {
		return "0m"
	}
	return strings.Join(parts, " ")
}

// Spec is the recurrence-defining subset of a reset schedule.
type Spec struct {
	Type       string
	TimeOfDay  string
	Timezone   string
	DayOfWeek  *int
	DayOfMonth *int
}

// Validate mirrors validateResetSchedule: a known type is required.
func Validate(spec Spec) error {
	for _, valid := range ValidTypes {
		if spec.Type == valid {
			return nil
		}
	}
	return fmt.Errorf("Invalid schedule type '%s'. Supported types: fiveHour, weekly, monthly", spec.Type)
}

// NextResetTime returns the next occurrence after now.
//
// previousNextReset is the schedule's current nextResetTime; only fiveHour
// uses it as an anchor so the interval timeline does not drift by scheduler
// latency (ported from calculateNextFiveHourReset).
func NextResetTime(spec Spec, now time.Time, previousNextReset *time.Time) (time.Time, error) {
	if err := Validate(spec); err != nil {
		return time.Time{}, err
	}

	switch spec.Type {
	case FiveHour:
		return nextFiveHour(now, previousNextReset), nil
	case Weekly:
		return nextWeekly(spec, now)
	case Monthly:
		return nextMonthly(spec, now)
	default:
		return time.Time{}, fmt.Errorf("Unknown schedule type: %s", spec.Type)
	}
}

func nextFiveHour(now time.Time, previousNextReset *time.Time) time.Time {
	const interval = 5 * time.Hour
	if previousNextReset == nil {
		return now.Add(interval)
	}
	next := previousNextReset.Add(interval)
	for !next.After(now) {
		next = next.Add(interval)
	}
	return next
}

func nextWeekly(spec Spec, now time.Time) (time.Time, error) {
	if spec.DayOfWeek == nil || *spec.DayOfWeek < 0 || *spec.DayOfWeek > 6 {
		return time.Time{}, fmt.Errorf("dayOfWeek must be 0-6 for weekly schedule")
	}
	if spec.TimeOfDay == "" {
		return time.Time{}, fmt.Errorf("timeOfDay is required for weekly schedule")
	}
	hour, minute, err := parseTimeOfDay(spec.TimeOfDay)
	if err != nil {
		return time.Time{}, err
	}

	loc := location(spec.Timezone)
	nowLocal := now.In(loc)

	currentDay := int(nowLocal.Weekday()) // Sunday = 0, same as JS getDay().
	daysUntil := (*spec.DayOfWeek - currentDay + 7) % 7

	target := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day()+daysUntil, hour, minute, 0, 0, loc)
	if daysUntil == 0 && !target.After(nowLocal) {
		target = time.Date(target.Year(), target.Month(), target.Day()+7, hour, minute, 0, 0, loc)
	}
	return target, nil
}

func nextMonthly(spec Spec, now time.Time) (time.Time, error) {
	if spec.DayOfMonth == nil || *spec.DayOfMonth < 1 || *spec.DayOfMonth > 31 {
		return time.Time{}, fmt.Errorf("dayOfMonth must be 1-31 for monthly schedule")
	}
	if spec.TimeOfDay == "" {
		return time.Time{}, fmt.Errorf("timeOfDay is required for monthly schedule")
	}
	hour, minute, err := parseTimeOfDay(spec.TimeOfDay)
	if err != nil {
		return time.Time{}, err
	}

	loc := location(spec.Timezone)
	nowLocal := now.In(loc)

	target := time.Date(
		nowLocal.Year(), nowLocal.Month(),
		clampDay(*spec.DayOfMonth, nowLocal.Year(), nowLocal.Month()),
		hour, minute, 0, 0, loc,
	)
	if !target.After(nowLocal) {
		year, month := nextMonth(nowLocal.Year(), nowLocal.Month())
		target = time.Date(year, month, clampDay(*spec.DayOfMonth, year, month), hour, minute, 0, 0, loc)
	}
	return target, nil
}

func parseTimeOfDay(value string) (int, int, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid timeOfDay %q", value)
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("invalid timeOfDay %q: %w", value, err)
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("invalid timeOfDay %q: %w", value, err)
	}
	return hour, minute, nil
}

// location resolves a timezone name, falling back to the process-local zone
// when unset or unknown (the old stack's try/catch fallback).
func location(name string) *time.Location {
	if name == "" {
		return time.Local
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.Local
	}
	return loc
}

// clampDay mirrors Math.min(dayOfMonth, daysInMonth).
func clampDay(dayOfMonth, year int, month time.Month) int {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if dayOfMonth > last {
		return last
	}
	return dayOfMonth
}

func nextMonth(year int, month time.Month) (int, time.Month) {
	if month == time.December {
		return year + 1, time.January
	}
	return year, month + 1
}

// ExtractScheduleFromOffset infers dayOfWeek / dayOfMonth / timeOfDay from a
// relative offset (ADR-0003 "从现在起" creation).
//
// The values are read off the resulting instant in the schedule's timezone, so
// a weekly offset beyond seven days simply wraps to the next occurrence of that
// weekday, and a monthly offset stores the actual inferred day rather than an
// idealized 31st the calculator would later clamp.
func ExtractScheduleFromOffset(specType string, offset Duration, timezone string, now time.Time) (Spec, error) {
	if err := Validate(Spec{Type: specType}); err != nil {
		return Spec{}, err
	}
	target := now.Add(time.Duration(offset.TotalMinutes()) * time.Minute).In(location(timezone))

	spec := Spec{Type: specType, TimeOfDay: formatTimeOfDay(target)}
	switch specType {
	case Weekly:
		day := int(target.Weekday())
		spec.DayOfWeek = &day
	case Monthly:
		day := target.Day()
		spec.DayOfMonth = &day
	}
	return spec, nil
}

func formatTimeOfDay(t time.Time) string {
	return fmt.Sprintf("%02d:%02d", t.Hour(), t.Minute())
}
