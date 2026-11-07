// Card-side reset-schedule grid (#27): countdown driven by the time signal,
// urgency colour grading for weekly/monthly rows (ADR-0013 gradient), and the
// manual exhausted toggle. Port of components/subscription-card/
// reset-schedule-grid.tsx plus the ticket's colour-grading demo.

import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetScheduleGrid } from "./ResetScheduleGrid";
import type { ResetSchedule } from "../subscriptions/types";

const NOW = new Date("2024-06-03T00:00:00.000Z").getTime();
const HOUR = 3_600_000;

function makeSchedule(overrides: Partial<ResetSchedule> = {}): ResetSchedule {
  return {
    id: "sched-1",
    enabled: true,
    type: "weekly",
    dayOfWeek: 4,
    timeOfDay: "05:00",
    timezone: "UTC",
    nextResetTime: new Date(NOW + 48 * HOUR).toISOString(),
    exhausted: false,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderGrid(schedules: ResetSchedule[]) {
  const onToggle = vi.fn();
  const result = render(() => (
    <ResetScheduleGrid schedules={schedules} onToggle={onToggle} />
  ));
  return { onToggle, result };
}

describe("ResetScheduleGrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders enabled schedules sorted by type with a countdown", () => {
    const { result } = renderGrid([
      makeSchedule({
        id: "m",
        type: "monthly",
        dayOfMonth: 15,
        timeOfDay: "10:00",
        nextResetTime: new Date(NOW + 24 * HOUR).toISOString(),
      }),
      makeSchedule({
        id: "f",
        type: "fiveHour",
        dayOfWeek: undefined,
        timeOfDay: undefined,
        timezone: undefined,
        nextResetTime: new Date(NOW + 3 * HOUR).toISOString(),
      }),
      makeSchedule({
        id: "w",
        type: "weekly",
        nextResetTime: new Date(NOW + 48 * HOUR).toISOString(),
      }),
      makeSchedule({ id: "disabled", enabled: false, type: "monthly" }),
    ]);

    const rows = result.container.querySelectorAll(".reset-schedule-grid-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("每5小时");
    expect(rows[1].textContent).toContain("每周周四");
    expect(rows[2].textContent).toContain("每月15日");
    expect(result.getAllByText(/后重置|即将重置/).length).toBeGreaterThan(0);
  });

  it("colors weekly and monthly countdowns by urgency (ADR-0013)", () => {
    const { result } = renderGrid([
      makeSchedule({
        id: "w",
        type: "weekly",
        nextResetTime: new Date(NOW + 48 * HOUR).toISOString(),
      }),
      makeSchedule({
        id: "m",
        type: "monthly",
        dayOfMonth: 15,
        timeOfDay: "10:00",
        nextResetTime: new Date(NOW + 180 * HOUR).toISOString(),
      }),
    ]);

    // The DOM normalizes the inline HSL to rgb; hsl(23, 76.7%, 31%) is
    // rgb(140, 65, 18). The pure colour string is asserted in reset.test.ts.
    const countdowns = result.container.querySelectorAll(
      ".reset-schedule-countdown"
    );
    expect((countdowns[0] as HTMLElement).style.color).toBe("rgb(140, 65, 18)");
    expect((countdowns[1] as HTMLElement).style.color).toBe("rgb(140, 65, 18)");
  });

  it("leaves far-out and five-hour countdowns uncolored", () => {
    const { result } = renderGrid([
      makeSchedule({
        id: "w",
        type: "weekly",
        nextResetTime: new Date(NOW + 100 * HOUR).toISOString(),
      }),
      makeSchedule({
        id: "f",
        type: "fiveHour",
        dayOfWeek: undefined,
        timeOfDay: undefined,
        timezone: undefined,
        nextResetTime: new Date(NOW + 1 * HOUR).toISOString(),
      }),
    ]);

    const countdowns = result.container.querySelectorAll(
      ".reset-schedule-countdown"
    );
    expect((countdowns[0] as HTMLElement).style.color).toBe("");
    expect((countdowns[1] as HTMLElement).style.color).toBe("");
  });

  it("toggles the exhausted flag through the row button", () => {
    const { onToggle, result } = renderGrid([
      makeSchedule({ id: "w", exhausted: true }),
    ]);

    const button = result.getByRole("button", { name: "已用尽" });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith("w", false);
  });

  it("refreshes the countdown after the 60-second tick", () => {
    const { result } = renderGrid([
      makeSchedule({
        id: "w",
        type: "weekly",
        nextResetTime: new Date(NOW + 61 * 60_000).toISOString(),
      }),
    ]);

    expect(result.getByText("1小时1分钟后重置")).toBeTruthy();
    vi.advanceTimersByTime(60_000);
    expect(result.getByText("1小时后重置")).toBeTruthy();
  });
});
