package reset

import (
	"testing"
	"time"
)

// Parity note (#27): lib/reset-schedule.ts's duration parsing, offset-based
// creation, and the weekly/monthly recurrence arithmetic (including month-end
// clamping and the 31→28→31 clamp/reset cycle) are locked here. The old stack
// had no direct unit tests for these helpers; these cases are the ported
// behavioural specification.

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", name, err)
	}
	return loc
}

func utc(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.UTC)
}

func intPtr(value int) *int { return &value }

// ---------- duration parsing (parseDurationString) ----------

func TestParseDurationString(t *testing.T) {
	cases := []struct {
		input string
		want  Duration
		ok    bool
	}{
		{"3d 5h 44m", Duration{Days: 3, Hours: 5, Minutes: 44}, true},
		{"3d5h44m", Duration{Days: 3, Hours: 5, Minutes: 44}, true},
		{" 3D   5H ", Duration{Days: 3, Hours: 5}, true},
		{"1d", Duration{Days: 1}, true},
		{"5h", Duration{Hours: 5}, true},
		{"44m", Duration{Minutes: 44}, true},
		{"1m", Duration{Minutes: 1}, true},
		{"0d 1h", Duration{Hours: 1}, true},
		{"0d 0h 0m", Duration{}, false},
		{"", Duration{}, false},
		{"abc", Duration{}, false},
		{"24h", Duration{}, false}, // hours must stay < 24
		{"60m", Duration{}, false}, // minutes must stay < 60
		{"5h 60m", Duration{}, false},
		{"-1d", Duration{Days: 1}, true}, // old regex ignores the sign
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got, ok := ParseDuration(tc.input)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v (got %#v)", ok, tc.ok, got)
			}
			if !ok {
				return
			}
			if got != tc.want {
				t.Fatalf("duration = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestFormatDuration(t *testing.T) {
	cases := []struct {
		duration Duration
		want     string
	}{
		{Duration{Days: 3, Hours: 5, Minutes: 44}, "3d 5h 44m"},
		{Duration{Days: 1}, "1d"},
		{Duration{Hours: 5}, "5h"},
		{Duration{Minutes: 44}, "44m"},
		{Duration{Days: 2, Minutes: 1}, "2d 1m"},
		{Duration{}, "0m"},
	}
	for _, tc := range cases {
		if got := FormatDuration(tc.duration); got != tc.want {
			t.Errorf("FormatDuration(%#v) = %q, want %q", tc.duration, got, tc.want)
		}
	}
}

func TestDurationMinutes(t *testing.T) {
	if got := (Duration{Days: 3, Hours: 5, Minutes: 44}).TotalMinutes(); got != 3*24*60+5*60+44 {
		t.Fatalf("Minutes() = %d", got)
	}
}

// ---------- offset-based creation (extractScheduleFromOffset) ----------

func TestExtractScheduleFromOffsetWeeklyInfersWeekdayAndTime(t *testing.T) {
	// Monday 2024-06-03 00:00 UTC + 3d5h = Thursday 05:00.
	now := utc(2024, time.June, 3, 0, 0)
	spec, err := ExtractScheduleFromOffset(Weekly, Duration{Days: 3, Hours: 5}, "UTC", now)
	if err != nil {
		t.Fatalf("ExtractScheduleFromOffset: %v", err)
	}
	if spec.DayOfWeek == nil || *spec.DayOfWeek != 4 {
		t.Fatalf("dayOfWeek = %v, want 4 (Thursday)", spec.DayOfWeek)
	}
	if spec.TimeOfDay != "05:00" {
		t.Fatalf("timeOfDay = %q, want 05:00", spec.TimeOfDay)
	}
	if spec.DayOfMonth != nil {
		t.Fatalf("weekly spec must not carry dayOfMonth: %v", *spec.DayOfMonth)
	}
}

func TestExtractScheduleFromOffsetWeeklyWrapsBeyondSevenDays(t *testing.T) {
	// ADR-0003: a 10-day offset from Monday lands on Thursday; future resets
	// follow every Thursday, not every 10 days.
	now := utc(2024, time.June, 3, 0, 0)
	spec, err := ExtractScheduleFromOffset(Weekly, Duration{Days: 10}, "UTC", now)
	if err != nil {
		t.Fatalf("ExtractScheduleFromOffset: %v", err)
	}
	if spec.DayOfWeek == nil || *spec.DayOfWeek != 4 {
		t.Fatalf("dayOfWeek = %v, want 4 (Thursday)", spec.DayOfWeek)
	}
}

func TestExtractScheduleFromOffsetMonthlyStoresActualDay(t *testing.T) {
	// ADR-0003: store the actual inferred day (the 2nd), not an idealized 31
	// that the backend would clamp.
	now := utc(2024, time.January, 30, 10, 0)
	spec, err := ExtractScheduleFromOffset(Monthly, Duration{Days: 3}, "UTC", now)
	if err != nil {
		t.Fatalf("ExtractScheduleFromOffset: %v", err)
	}
	if spec.DayOfMonth == nil || *spec.DayOfMonth != 2 {
		t.Fatalf("dayOfMonth = %v, want 2", spec.DayOfMonth)
	}
	if spec.TimeOfDay != "10:00" {
		t.Fatalf("timeOfDay = %q, want 10:00", spec.TimeOfDay)
	}
}

func TestExtractScheduleFromOffsetUsesTimezone(t *testing.T) {
	// Monday 2024-06-03 23:30 UTC is Tuesday 07:30 in Shanghai.
	now := utc(2024, time.June, 3, 23, 30)
	spec, err := ExtractScheduleFromOffset(Weekly, Duration{Hours: 2}, "Asia/Shanghai", now)
	if err != nil {
		t.Fatalf("ExtractScheduleFromOffset: %v", err)
	}
	if spec.DayOfWeek == nil || *spec.DayOfWeek != 2 {
		t.Fatalf("dayOfWeek = %v, want 2 (Tuesday)", spec.DayOfWeek)
	}
	if spec.TimeOfDay != "09:30" {
		t.Fatalf("timeOfDay = %q, want 09:30", spec.TimeOfDay)
	}
}

func TestExtractScheduleFromOffsetFiveHourKeepsTimeOnly(t *testing.T) {
	now := utc(2024, time.June, 3, 10, 0)
	spec, err := ExtractScheduleFromOffset(FiveHour, Duration{Hours: 5}, "UTC", now)
	if err != nil {
		t.Fatalf("ExtractScheduleFromOffset: %v", err)
	}
	if spec.DayOfWeek != nil || spec.DayOfMonth != nil {
		t.Fatalf("fiveHour spec must only carry timeOfDay: %#v", spec)
	}
	if spec.TimeOfDay != "15:00" {
		t.Fatalf("timeOfDay = %q, want 15:00", spec.TimeOfDay)
	}
}

// ---------- weekly recurrence ----------

func TestNextWeeklyReturnsUpcomingWeekday(t *testing.T) {
	// Monday 10:00, target Monday 15:00 → later today.
	now := utc(2024, time.June, 3, 10, 0)
	got, err := NextResetTime(Spec{Type: Weekly, DayOfWeek: intPtr(1), TimeOfDay: "15:00", Timezone: "UTC"}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.June, 3, 15, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

func TestNextWeeklyPushesToNextWeekWhenTimePassed(t *testing.T) {
	// Monday 16:00, target Monday 15:00 → next Monday.
	now := utc(2024, time.June, 3, 16, 0)
	got, err := NextResetTime(Spec{Type: Weekly, DayOfWeek: intPtr(1), TimeOfDay: "15:00", Timezone: "UTC"}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.June, 10, 15, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

func TestNextWeeklyHonorsTimezoneWallClock(t *testing.T) {
	// Monday 08:00 UTC is Monday 16:00 in Shanghai; the Monday-15:00 slot has
	// passed there, so the next occurrence is the following Monday.
	now := utc(2024, time.June, 3, 8, 0)
	got, err := NextResetTime(Spec{
		Type: Weekly, DayOfWeek: intPtr(1), TimeOfDay: "15:00", Timezone: "Asia/Shanghai",
	}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	want := time.Date(2024, time.June, 10, 15, 0, 0, 0, mustLocation(t, "Asia/Shanghai"))
	if !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got.UTC(), want.UTC())
	}
}

func TestNextWeeklyRejectsInvalidSpec(t *testing.T) {
	now := utc(2024, time.June, 3, 10, 0)
	if _, err := NextResetTime(Spec{Type: Weekly, TimeOfDay: "10:00", Timezone: "UTC"}, now, nil); err == nil {
		t.Fatal("missing dayOfWeek must error")
	}
	if _, err := NextResetTime(Spec{Type: Weekly, DayOfWeek: intPtr(7), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil); err == nil {
		t.Fatal("dayOfWeek 7 must error")
	}
	if _, err := NextResetTime(Spec{Type: Weekly, DayOfWeek: intPtr(1), Timezone: "UTC"}, now, nil); err == nil {
		t.Fatal("missing timeOfDay must error")
	}
}

// ---------- monthly recurrence: month-end clamp and drift ----------

func TestNextMonthlyClampsDayToShortMonth(t *testing.T) {
	// Day 31 in February clamps to the 28th (non-leap).
	now := utc(2025, time.February, 10, 0, 0)
	got, err := NextResetTime(Spec{Type: Monthly, DayOfMonth: intPtr(31), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2025, time.February, 28, 10, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

func TestNextMonthlyClampsToLeapFebruary(t *testing.T) {
	now := utc(2024, time.February, 10, 0, 0)
	got, err := NextResetTime(Spec{Type: Monthly, DayOfMonth: intPtr(31), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.February, 29, 10, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

func TestNextMonthlyClampsToThirtyDayMonth(t *testing.T) {
	now := utc(2024, time.April, 10, 0, 0)
	got, err := NextResetTime(Spec{Type: Monthly, DayOfMonth: intPtr(31), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.April, 30, 10, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

// The 31→28 clamp is per month only: after the February clamp fires, March
// returns to the configured 31st. The stored dayOfMonth never drifts.
func TestNextMonthlyClampDoesNotDrift(t *testing.T) {
	spec := Spec{Type: Monthly, DayOfMonth: intPtr(31), TimeOfDay: "10:00", Timezone: "UTC"}

	january, err := NextResetTime(spec, utc(2025, time.January, 31, 12, 0), nil)
	if err != nil {
		t.Fatalf("January: %v", err)
	}
	if want := utc(2025, time.February, 28, 10, 0); !january.Equal(want) {
		t.Fatalf("from Jan 31 next = %v, want %v", january, want)
	}

	pg := january
	february, err := NextResetTime(spec, january, &pg)
	if err != nil {
		t.Fatalf("February: %v", err)
	}
	if want := utc(2025, time.March, 31, 10, 0); !february.Equal(want) {
		t.Fatalf("after Feb clamp next = %v, want %v", february, want)
	}
}

func TestNextMonthlyAdvancesWhenTargetPassed(t *testing.T) {
	now := utc(2024, time.June, 15, 12, 0)
	got, err := NextResetTime(Spec{Type: Monthly, DayOfMonth: intPtr(15), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.July, 15, 10, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

func TestNextMonthlyHonorsTimezoneWallClock(t *testing.T) {
	// 2024-06-30 20:00 UTC is 2024-07-01 04:00 in Shanghai, so the July 1st
	// slot has already passed and the next reset is August 1st.
	now := utc(2024, time.June, 30, 20, 0)
	got, err := NextResetTime(Spec{
		Type: Monthly, DayOfMonth: intPtr(1), TimeOfDay: "03:00", Timezone: "Asia/Shanghai",
	}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	want := time.Date(2024, time.August, 1, 3, 0, 0, 0, mustLocation(t, "Asia/Shanghai"))
	if !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got.UTC(), want.UTC())
	}
}

func TestNextMonthlyRejectsInvalidSpec(t *testing.T) {
	now := utc(2024, time.June, 3, 10, 0)
	if _, err := NextResetTime(Spec{Type: Monthly, TimeOfDay: "10:00", Timezone: "UTC"}, now, nil); err == nil {
		t.Fatal("missing dayOfMonth must error")
	}
	if _, err := NextResetTime(Spec{Type: Monthly, DayOfMonth: intPtr(0), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil); err == nil {
		t.Fatal("dayOfMonth 0 must error")
	}
	if _, err := NextResetTime(Spec{Type: Monthly, DayOfMonth: intPtr(32), TimeOfDay: "10:00", Timezone: "UTC"}, now, nil); err == nil {
		t.Fatal("dayOfMonth 32 must error")
	}
}

// ---------- fiveHour recurrence: anchor keeps the timeline stable ----------

func TestNextFiveHourWithoutAnchorStartsFromNow(t *testing.T) {
	now := utc(2024, time.June, 3, 10, 0)
	got, err := NextResetTime(Spec{Type: FiveHour}, now, nil)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.June, 3, 15, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

func TestNextFiveHourAnchorsToPreviousReset(t *testing.T) {
	previous := utc(2024, time.June, 3, 10, 0)
	now := previous.Add(4*time.Hour + 2*time.Minute) // scheduler ran 2 min late
	got, err := NextResetTime(Spec{Type: FiveHour}, now, &previous)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if want := utc(2024, time.June, 3, 15, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v (no scheduler-latency drift)", got, want)
	}
}

func TestNextFiveHourSkipsMissedCycles(t *testing.T) {
	previous := utc(2024, time.June, 1, 10, 0)
	now := utc(2024, time.June, 3, 10, 0) // process was down; two days later
	got, err := NextResetTime(Spec{Type: FiveHour}, now, &previous)
	if err != nil {
		t.Fatalf("NextResetTime: %v", err)
	}
	if !got.After(now) {
		t.Fatalf("next = %v, want after now %v", got, now)
	}
	// Jun 1 10:00 + n*5h: the first slot after Jun 3 10:00 is 12:00.
	if want := utc(2024, time.June, 3, 12, 0); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
}

// ---------- validation (validateResetSchedule) ----------

func TestValidateRejectsUnknownType(t *testing.T) {
	if err := Validate(Spec{Type: "hourly"}); err == nil {
		t.Fatal("unknown type must error")
	}
	for _, valid := range ValidTypes {
		if err := Validate(Spec{Type: valid}); err != nil {
			t.Fatalf("Validate(%q) = %v", valid, err)
		}
	}
}
