// Reset-time domain maths for the Solid frontend (#27).
//
// Parity: the `getResetUrgencyColor` block of __tests__/utils.test.ts (17
// cases — thresholds, boundary points, red clamp, interpolation, easing,
// monotonicity, edge cases) is ported verbatim. The rest of utils.test.ts
// (usage percent/tier/currency/balance helpers) belongs to #28.
//
// The creation maths (duration parsing, offset inference, recurrence with
// month-end clamp) mirror lib/reset-schedule.ts; the Go side
// (server/internal/reset) is the authority for the tick, and these tests keep
// the client-side preview/create path in step with it.

import { describe, expect, it } from "vitest";
import {
  RESET_URGENCY_THRESHOLDS,
  createResetSchedule,
  extractScheduleFromOffset,
  formatDuration,
  formatNextResetTime,
  getResetUrgencyColor,
  getScheduleTypeLabel,
  getTimezoneAbbr,
  calculateNextResetTime,
  parseDurationString,
  sortResetSchedules,
} from "./reset";
import type { ResetSchedule, ResetScheduleType } from "./types";

const HOUR = 3_600_000;

// ============ getResetUrgencyColor ============

describe("getResetUrgencyColor", () => {
  describe("threshold constants", () => {
    it("matches the spec values", () => {
      expect(RESET_URGENCY_THRESHOLDS.weekly.redHours).toBe(24);
      expect(RESET_URGENCY_THRESHOLDS.weekly.yellowHours).toBe(72);
      expect(RESET_URGENCY_THRESHOLDS.monthly.redHours).toBe(120);
      expect(RESET_URGENCY_THRESHOLDS.monthly.yellowHours).toBe(240);
    });
  });

  describe("boundary points", () => {
    it("weekly exactly 72h → null", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 72 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBeNull();
    });

    it("weekly exactly 24h → interpolation endpoint, soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 24 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });

    it("monthly exactly 240h → null", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 240 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBeNull();
    });

    it("monthly exactly 120h → interpolation endpoint, soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 120 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });
  });

  describe("red clamp", () => {
    it("weekly 1h remaining → soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 1 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });

    it("monthly 24h remaining → soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 24 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });

    it("expired (past resetTime) → soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now - 1 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });
  });

  describe("midpoint interpolation", () => {
    it("weekly 48h remaining → hsl(28, 82.6%, 65%)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 48 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(28, 82.6%, 65%)"
      );
    });

    it("monthly 180h remaining → hsl(28, 82.6%, 65%)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 180 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBe(
        "hsl(28, 82.6%, 65%)"
      );
    });
  });

  describe("exponential easing", () => {
    it("weekly 60h (x=0.25) → hue ≈ 39, slower than linear (36)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 60 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(39, 89.3%, 68.8%)"
      );
    });

    it("weekly 36h (x=0.75) → hue ≈ 15, steep catch-up vs linear (12)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 36 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(15, 74.5%, 60.4%)"
      );
    });

    it("weekly 30h (x≈0.875) → hue ≈ 8, accelerating toward red endpoint", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 30 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(8, 70%, 57.8%)"
      );
    });
  });

  describe("gradient monotonicity", () => {
    it("hue decreases as remaining time decreases (weekly)", () => {
      const now = 1_000_000_000_000;
      const hours = [66, 60, 54, 48, 42, 36, 30];
      const hues = hours.map((h) => {
        const resetTime = new Date(now + h * HOUR).toISOString();
        const color = getResetUrgencyColor("weekly", resetTime, now)!;
        return parseInt(color.match(/hsl\((\d+)/)![1], 10);
      });
      for (let i = 1; i < hues.length; i++) {
        expect(hues[i]).toBeLessThanOrEqual(hues[i - 1]);
      }
    });
  });

  describe("edge cases", () => {
    it("null resetTime → null", () => {
      expect(getResetUrgencyColor("weekly", null)).toBeNull();
      expect(getResetUrgencyColor("monthly", null)).toBeNull();
    });

    it("now parameter injection produces deterministic results", () => {
      const fixedNow = 1_700_000_000_000;
      const resetTime = new Date(fixedNow + 48 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, fixedNow)).toBe(
        "hsl(28, 82.6%, 65%)"
      );
    });

    it("invalid ISO string → null", () => {
      expect(getResetUrgencyColor("weekly", "not-a-date")).toBeNull();
    });
  });
});

// ============ countdown text (formatNextResetTime) ============

describe("formatNextResetTime", () => {
  const now = new Date("2024-06-01T12:00:00.000Z").getTime();

  const cases: Array<[number, string]> = [
    [-1, "即将重置"],
    [0, "0分钟后重置"],
    [59, "59分钟后重置"],
    [60, "1小时后重置"],
    [90, "1小时30分钟后重置"],
    [24 * 60, "1天后重置"],
    [24 * 60 + 60, "1天1小时后重置"],
    [24 * 60 + 5, "1天5分钟后重置"],
    [3 * 24 * 60 + 5 * 60 + 44, "3天5小时44分钟后重置"],
  ];

  for (const [minutes, expected] of cases) {
    it(`${minutes}m → ${expected}`, () => {
      const iso = new Date(now + minutes * 60_000).toISOString();
      expect(formatNextResetTime(iso, now)).toBe(expected);
    });
  }
});

// ============ duration parsing / formatting ============

describe("parseDurationString / formatDuration", () => {
  it("parses day/hour/minute components in any spacing or case", () => {
    expect(parseDurationString("3d 5h 44m")).toEqual({
      days: 3,
      hours: 5,
      minutes: 44,
    });
    expect(parseDurationString("3D5H")).toEqual({
      days: 3,
      hours: 5,
      minutes: 0,
    });
    expect(parseDurationString(" 44m ")).toEqual({
      days: 0,
      hours: 0,
      minutes: 44,
    });
  });

  it("rejects empty, all-zero, and out-of-range values", () => {
    expect(parseDurationString("")).toBeNull();
    expect(parseDurationString("abc")).toBeNull();
    expect(parseDurationString("0d 0m")).toBeNull();
    expect(parseDurationString("24h")).toBeNull();
    expect(parseDurationString("60m")).toBeNull();
  });

  it("formats components back in the canonical order", () => {
    expect(formatDuration(3, 5, 44)).toBe("3d 5h 44m");
    expect(formatDuration(0, 0, 0)).toBe("0m");
    expect(formatDuration(2, 0, 1)).toBe("2d 1m");
  });
});

// ============ offset-based creation (ADR-0003) ============

const monday = new Date("2024-06-03T00:00:00.000Z");

describe("extractScheduleFromOffset", () => {
  it("infers weekday and time for weekly schedules", () => {
    const inferred = extractScheduleFromOffset(
      "weekly",
      3 * 24 * 60 + 5 * 60,
      "UTC",
      monday
    );
    expect(inferred.dayOfWeek).toBe(4); // Thursday
    expect(inferred.timeOfDay).toBe("05:00");
    expect(inferred.dayOfMonth).toBeUndefined();
  });

  it("wraps offsets beyond seven days to the next weekday", () => {
    const inferred = extractScheduleFromOffset(
      "weekly",
      10 * 24 * 60,
      "UTC",
      monday
    );
    expect(inferred.dayOfWeek).toBe(4);
  });

  it("stores the actual inferred day for monthly schedules", () => {
    const inferred = extractScheduleFromOffset(
      "monthly",
      3 * 24 * 60,
      "UTC",
      new Date("2024-01-30T10:00:00.000Z")
    );
    expect(inferred.dayOfMonth).toBe(2);
    expect(inferred.timeOfDay).toBe("10:00");
  });

  it("reads the wall clock in the schedule timezone", () => {
    const inferred = extractScheduleFromOffset(
      "weekly",
      2 * 60,
      "Asia/Shanghai",
      new Date("2024-06-03T23:30:00.000Z")
    );
    expect(inferred.dayOfWeek).toBe(2); // Tuesday in Shanghai
    expect(inferred.timeOfDay).toBe("09:30");
  });
});

// ============ recurrence arithmetic ============

function spec(overrides: Partial<ResetSchedule>): ResetSchedule {
  return {
    id: "s",
    enabled: true,
    type: "monthly",
    nextResetTime: "2024-01-01T00:00:00.000Z",
    exhausted: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("calculateNextResetTime", () => {
  it("clamps day 31 to the last day of a short month", () => {
    const next = calculateNextResetTime(
      spec({
        type: "monthly",
        dayOfMonth: 31,
        timeOfDay: "10:00",
        timezone: "UTC",
      }),
      new Date("2025-02-10T00:00:00.000Z")
    );
    expect(next.toISOString()).toBe("2025-02-28T10:00:00.000Z");
  });

  it("does not drift: March returns to the configured 31st", () => {
    const february = calculateNextResetTime(
      spec({
        type: "monthly",
        dayOfMonth: 31,
        timeOfDay: "10:00",
        timezone: "UTC",
      }),
      new Date("2025-01-31T12:00:00.000Z")
    );
    expect(february.toISOString()).toBe("2025-02-28T10:00:00.000Z");

    const march = calculateNextResetTime(
      spec({
        type: "monthly",
        dayOfMonth: 31,
        timeOfDay: "10:00",
        timezone: "UTC",
      }),
      february
    );
    expect(march.toISOString()).toBe("2025-03-31T10:00:00.000Z");
  });

  it("anchors five-hour schedules to the previous reset", () => {
    const previous = new Date("2024-06-03T10:00:00.000Z");
    const next = calculateNextResetTime(
      spec({ type: "fiveHour" }),
      new Date(previous.getTime() + 4 * HOUR + 2 * 60_000),
      previous
    );
    expect(next.toISOString()).toBe("2024-06-03T15:00:00.000Z");
  });

  it("rolls weekly schedules to the next occurrence", () => {
    const next = calculateNextResetTime(
      spec({
        type: "weekly",
        dayOfWeek: 1,
        timeOfDay: "15:00",
        timezone: "UTC",
      }),
      new Date("2024-06-03T16:00:00.000Z")
    );
    expect(next.toISOString()).toBe("2024-06-10T15:00:00.000Z");
  });
});

describe("createResetSchedule", () => {
  it("mints identity, timestamps and nextResetTime from the spec", () => {
    const now = new Date("2024-06-03T10:00:00.000Z");
    const schedule = createResetSchedule(
      {
        type: "weekly",
        dayOfWeek: 1,
        timeOfDay: "15:00",
        timezone: "UTC",
      },
      now
    );
    expect(schedule.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(schedule.enabled).toBe(true);
    expect(schedule.exhausted).toBe(false);
    expect(schedule.createdAt).toBe(now.toISOString());
    expect(schedule.nextResetTime).toBe("2024-06-03T15:00:00.000Z");
  });

  it("honors an explicit nextResetTime override (offset five-hour)", () => {
    const now = new Date("2024-06-03T10:00:00.000Z");
    const schedule = createResetSchedule(
      { type: "fiveHour", nextResetTime: "2024-06-03T14:30:00.000Z" },
      now
    );
    expect(schedule.nextResetTime).toBe("2024-06-03T14:30:00.000Z");
  });
});

describe("schedule display helpers", () => {
  it("sorts by type order fiveHour → weekly → monthly", () => {
    const sorted = sortResetSchedules([
      spec({ id: "m", type: "monthly" }),
      spec({ id: "f", type: "fiveHour" }),
      spec({ id: "w", type: "weekly" }),
    ]);
    expect(sorted.map((schedule) => schedule.id)).toEqual(["f", "w", "m"]);
  });

  it("labels schedule types", () => {
    expect(getScheduleTypeLabel("fiveHour")).toBe("每5小时");
    expect(getScheduleTypeLabel("weekly")).toBe("每周");
    expect(getScheduleTypeLabel("monthly")).toBe("每月");
  });

  it("abbreviates known timezones", () => {
    expect(getTimezoneAbbr("Asia/Shanghai")).toBe("上海时间");
    expect(getTimezoneAbbr("UTC")).toBe("UTC");
    expect(getTimezoneAbbr("America/New_York")).toBe("纽约时间");
    expect(getTimezoneAbbr(undefined)).toBe("");
  });
});
