// Reset-schedule domain maths for the Solid frontend (#27).
//
// Ports lib/reset-schedule.ts and the reset-time helpers of lib/utils.ts. The
// Go side (server/internal/reset) owns the persisted tick arithmetic; this
// module is what the form uses to build a schedule in the browser, so both
// sides must agree — see server/internal/reset/reset_test.go and reset.test.ts.

import { uuidv4 } from "./uuid";
import type { ResetSchedule, ResetScheduleType } from "./types";

const SCHEDULE_TYPE_ORDER: Record<ResetScheduleType, number> = {
  fiveHour: 0,
  weekly: 1,
  monthly: 2,
};

export const RESET_SCHEDULE_TYPES: ResetScheduleType[] = [
  "fiveHour",
  "weekly",
  "monthly",
];

/** The recurrence-defining subset of a reset schedule. */
export type ResetScheduleSpec = Pick<
  ResetSchedule,
  "type" | "timeOfDay" | "timezone" | "dayOfWeek" | "dayOfMonth"
>;

export function sortResetSchedules(
  schedules: ResetSchedule[]
): ResetSchedule[] {
  return [...schedules].sort(
    (a, b) => SCHEDULE_TYPE_ORDER[a.type] - SCHEDULE_TYPE_ORDER[b.type]
  );
}

export function validateResetSchedule(schedule: Partial<ResetSchedule>): void {
  if (!schedule.type) {
    throw new Error("Schedule type is required");
  }
  if (!RESET_SCHEDULE_TYPES.includes(schedule.type)) {
    throw new Error(
      `Invalid schedule type '${schedule.type}'. Supported types: fiveHour, weekly, monthly`
    );
  }
  if ("referenceTime" in schedule) {
    throw new Error(
      "Field 'referenceTime' is no longer supported. Use nextResetTime instead."
    );
  }
  if ("timezoneOffset" in schedule) {
    throw new Error(
      "Field 'timezoneOffset' is no longer supported. Use timezone instead."
    );
  }
}

// ---------- duration parsing ----------

export interface ParsedDuration {
  days: number;
  hours: number;
  minutes: number;
}

export function parseDurationString(duration: string): ParsedDuration | null {
  const trimmed = duration.replace(/\s+/g, "").toLowerCase();

  const daysMatch = trimmed.match(/(\d+)d/);
  const hoursMatch = trimmed.match(/(\d+)h/);
  const minutesMatch = trimmed.match(/(\d+)m/);

  const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;

  if (days === 0 && hours === 0 && minutes === 0) return null;
  if (hours > 23 || minutes > 59) return null;

  return { days, hours, minutes };
}

export function formatDuration(
  days: number,
  hours: number,
  minutes: number
): string {
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(" ") || "0m";
}

export function durationMinutes(duration: ParsedDuration): number {
  return duration.days * 24 * 60 + duration.hours * 60 + duration.minutes;
}

// ---------- recurrence ----------

/**
 * Returns the next occurrence of the schedule's recurrence after `now`.
 *
 * The five-hour type anchors on the schedule's previous nextResetTime when one
 * is passed (a reset just fired), so the interval timeline does not drift by
 * scheduler latency; missed cycles are skipped until the result is in the
 * future. Weekly and monthly resolve the next wall-clock occurrence in the
 * schedule's timezone, clamping the day to the length of the target month.
 */
export function calculateNextResetTime(
  schedule: ResetScheduleSpec,
  now: Date = new Date(),
  previousNextResetTime?: Date
): Date {
  switch (schedule.type) {
    case "fiveHour":
      return nextFiveHour(now, previousNextResetTime);
    case "weekly":
      return nextWeekly(schedule, now);
    case "monthly":
      return nextMonthly(schedule, now);
    default:
      throw new Error(`Unknown schedule type: ${schedule.type}`);
  }
}

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;

function nextFiveHour(now: Date, previousNextResetTime?: Date): Date {
  if (previousNextResetTime) {
    let next = new Date(previousNextResetTime.getTime() + FIVE_HOUR_MS);
    while (next <= now) {
      next = new Date(next.getTime() + FIVE_HOUR_MS);
    }
    return next;
  }
  return new Date(now.getTime() + FIVE_HOUR_MS);
}

function parseTimeOfDay(
  timeOfDay: string | undefined,
  kind: string
): [number, number] {
  if (!timeOfDay) {
    throw new Error(`timeOfDay is required for ${kind} schedule`);
  }
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  return [hours, minutes];
}

/** Length of the month containing (year, monthIndex). */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Builds the target instant for a wall-clock (hour, minute) in `timezone`,
 * expressed as an absolute Date.
 *
 * JS Date arithmetic is offset-based, so the target is computed on the wall
 * clock in the schedule's zone and then shifted back by the zone's current
 * offset — the same approach as lib/reset-schedule.ts.
 */
function zonedTarget(
  now: Date,
  timezone: string | undefined,
  mutate: (wallClock: Date) => void
): Date {
  const wallClock = timezone ? zonedWallClock(now, timezone) : new Date(now);
  mutate(wallClock);
  if (!timezone) return wallClock;
  const offset = now.getTime() - zonedWallClock(now, timezone).getTime();
  return new Date(wallClock.getTime() + offset);
}

function zonedWallClock(now: Date, timezone: string): Date {
  try {
    return new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  } catch {
    return new Date(now);
  }
}

function nextWeekly(schedule: ResetScheduleSpec, now: Date): Date {
  const { dayOfWeek } = schedule;
  if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error("dayOfWeek must be 0-6 for weekly schedule");
  }
  const [hours, minutes] = parseTimeOfDay(schedule.timeOfDay, "weekly");

  return zonedTarget(now, schedule.timezone, (wallClock) => {
    wallClock.setHours(hours, minutes, 0, 0);
    const currentDay = wallClock.getDay();
    const daysUntil = (dayOfWeek - currentDay + 7) % 7;
    if (
      daysUntil === 0 &&
      wallClock <= zonedWallClock(now, schedule.timezone ?? "")
    ) {
      wallClock.setDate(wallClock.getDate() + 7);
    } else {
      wallClock.setDate(wallClock.getDate() + daysUntil);
    }
  });
}

function nextMonthly(schedule: ResetScheduleSpec, now: Date): Date {
  const { dayOfMonth } = schedule;
  if (dayOfMonth === undefined || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error("dayOfMonth must be 1-31 for monthly schedule");
  }
  const [hours, minutes] = parseTimeOfDay(schedule.timeOfDay, "monthly");

  return zonedTarget(now, schedule.timezone, (wallClock) => {
    wallClock.setHours(hours, minutes, 0, 0);

    // Compute the year/month explicitly rather than calling setMonth on a
    // day-31 date: JS rolls setMonth(1) on Jan 31 over to Mar 3, which would
    // skip February instead of clamping to the 28th (the old stack's bug).
    let year = wallClock.getFullYear();
    let month = wallClock.getMonth();
    wallClock.setDate(Math.min(dayOfMonth, daysInMonth(year, month)));
    if (wallClock <= zonedWallClock(now, schedule.timezone ?? "")) {
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
      wallClock.setFullYear(
        year,
        month,
        Math.min(dayOfMonth, daysInMonth(year, month))
      );
    }
  });
}

// ---------- creation ----------

export interface CreateResetScheduleInput extends ResetScheduleSpec {
  enabled?: boolean;
  /** Pins the first reset explicitly (the five-hour offset/direct shortcut). */
  nextResetTime?: string;
}

export function createResetSchedule(
  input: CreateResetScheduleInput,
  now: Date = new Date()
): ResetSchedule {
  const spec: ResetScheduleSpec = {
    type: input.type,
    timeOfDay: input.timeOfDay,
    timezone: input.timezone,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
  };
  const nextResetTime =
    input.nextResetTime ?? calculateNextResetTime(spec, now).toISOString();

  return {
    ...spec,
    id: uuidv4(),
    enabled: input.enabled ?? true,
    nextResetTime,
    exhausted: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

// ---------- offset-based creation (ADR-0003) ----------

export interface InferredSchedule {
  dayOfWeek?: number;
  dayOfMonth?: number;
  timeOfDay: string;
}

/**
 * Infers the schedule pattern from a relative offset ("从现在起"). The values
 * are read off the resulting instant in the schedule's timezone: a weekly
 * offset beyond seven days wraps to that weekday, and a monthly offset stores
 * the actual inferred day rather than an idealized 31st.
 */
export function extractScheduleFromOffset(
  type: ResetScheduleType,
  offsetMinutes: number,
  timezone?: string,
  now: Date = new Date()
): InferredSchedule {
  const target = zonedWallClock(
    new Date(now.getTime() + offsetMinutes * 60_000),
    timezone ?? ""
  );
  const result: InferredSchedule = {
    timeOfDay: `${String(target.getHours()).padStart(2, "0")}:${String(
      target.getMinutes()
    ).padStart(2, "0")}`,
  };
  if (type === "weekly") result.dayOfWeek = target.getDay();
  if (type === "monthly") result.dayOfMonth = target.getDate();
  return result;
}

// ---------- display ----------

export const RESET_URGENCY_THRESHOLDS = {
  weekly: { redHours: 24, yellowHours: 72 },
  monthly: { redHours: 120, yellowHours: 240 },
} as const;

/**
 * Returns an HSL color for an upcoming reset, or null when no coloring applies
 * (resetTime null, or remaining time at/above the yellow threshold).
 *
 * Ported from lib/utils.ts / ADR-0013: convex 2^x−1 easing from the yellow
 * threshold to soft red at the red threshold, clamped at or below it. The
 * ramp is re-anchored to text-grade lightness (ADR-0013 curve, 2026-11-07):
 * the old pale-yellow→55% red range rendered countdown text below the 4.5:1
 * contrast the design system commits to, so the endpoints are dark amber →
 * dark red (both ≥4.5:1 on the sheet and the alternating-row tint) while the
 * easing, thresholds and monotonicity stay identical.
 */
export function getResetUrgencyColor(
  kind: "weekly" | "monthly",
  resetTime: string | null,
  now: number = Date.now()
): string | null {
  if (resetTime === null) return null;

  const thresholds = RESET_URGENCY_THRESHOLDS[kind];
  const redMs = thresholds.redHours * 3_600_000;
  const yellowMs = thresholds.yellowHours * 3_600_000;

  const resetMs = new Date(resetTime).getTime();
  if (Number.isNaN(resetMs)) return null;

  const remaining = resetMs - now;
  if (remaining >= yellowMs) return null;
  if (remaining < redMs) return "hsl(0, 65%, 38%)";

  const x = (yellowMs - remaining) / (yellowMs - redMs);
  const tp = Math.pow(2, x) - 1;
  const h = 40 * (1 - tp);
  const s = 85 - 20 * tp;
  const l = 26 + 12 * tp;

  return `hsl(${Math.round(h)}, ${Math.round(s * 10) / 10}%, ${
    Math.round(l * 10) / 10
  }%)`;
}

/**
 * Reflects an urgency colour's lightness for the dark theme (l → 96−l), the
 * same move the semantic tokens make (#B23A24 → #E4654B): the ramp is
 * anchored dark for the light theme's paper, and its mirror reads on the
 * dark theme's sheets. No-op outside the dark theme or on non-HSL input.
 */
export function urgencyColorForTheme(
  color: string | null | undefined,
  dark: boolean
): string | undefined {
  if (!color || !dark) return color ?? undefined;
  const match = color.match(/^hsl\(([\d.]+), ([\d.]+)%, ([\d.]+)%\)$/);
  if (!match) return color;
  const [, h, s, l] = match;
  return `hsl(${h}, ${s}%, ${Math.round((96 - Number(l)) * 10) / 10}%)`;
}

export function isDarkTheme(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

const TIMEZONE_ABBR_MAP: Record<string, string> = {
  "Asia/Shanghai": "上海时间",
  "Asia/Hong_Kong": "香港时间",
  "Asia/Tokyo": "东京时间",
  "America/New_York": "纽约时间",
  "America/Los_Angeles": "洛杉矶时间",
  "Europe/London": "伦敦时间",
  UTC: "UTC",
};

export function getTimezoneAbbr(timezone?: string): string {
  if (!timezone) return "";
  return TIMEZONE_ABBR_MAP[timezone] || timezone.split("/").pop() || timezone;
}

export function getScheduleTypeLabel(type: string): string {
  switch (type) {
    case "fiveHour":
      return "每5小时";
    case "weekly":
      return "每周";
    case "monthly":
      return "每月";
    default:
      return type;
  }
}

/**
 * Countdown text ("3天5小时后重置"). `now` is injectable so the caller can drive
 * it from the createNow() signal instead of the wall clock at render time.
 */
export function formatNextResetTime(
  isoString: string,
  now: number = Date.now()
): string {
  const diffMs = new Date(isoString).getTime() - now;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 0) return "即将重置";
  if (diffMins < 60) return `${diffMins}分钟后重置`;
  if (diffHours < 24) {
    return remainingMins === 0
      ? `${diffHours}小时后重置`
      : `${diffHours}小时${remainingMins}分钟后重置`;
  }

  const remainingHours = diffHours % 24;
  if (remainingHours === 0 && remainingMins === 0) return `${diffDays}天后重置`;
  if (remainingMins === 0) return `${diffDays}天${remainingHours}小时后重置`;
  if (remainingHours === 0) return `${diffDays}天${remainingMins}分钟后重置`;
  return `${diffDays}天${remainingHours}小时${remainingMins}分钟后重置`;
}
