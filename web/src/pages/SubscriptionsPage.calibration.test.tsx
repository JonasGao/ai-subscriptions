// Page-level flow for query-driven calibration (#34, ADR-0016): the usage
// response's calibrated subscription replaces the stale list entry in place
// (no card remount / re-query), and the edit form shows the calibrated schedule
// values immediately.

import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "../test-utils";
import type { ResetSchedule, Subscription } from "../subscriptions/types";

const activeSession = {
  body: {
    user: {
      id: "1",
      username: "admin",
      name: "admin",
      email: "admin@local",
      isInitial: false,
    },
  },
};

function schedule(overrides: Partial<ResetSchedule> = {}): ResetSchedule {
  return {
    id: "sched-monthly",
    enabled: true,
    type: "monthly",
    dayOfMonth: 1,
    timeOfDay: "00:00",
    timezone: "UTC",
    nextResetTime: "2024-07-01T00:00:00.000Z",
    exhausted: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Kimi Code",
    category: "官方订阅",
    provider: "moonshot",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    planId: "kimi-code",
    hasCredentials: true,
    resetSchedules: [schedule()],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("查询驱动的重置计划校准", () => {
  it("replaces the list entry and shows calibrated values in the edit form", async () => {
    const stale = subscription();
    const calibrated = subscription({
      resetSchedules: [
        schedule({
          dayOfMonth: 15,
          timeOfDay: "12:00",
          nextResetTime: "2099-07-15T12:00:00.000Z",
        }),
      ],
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    const fetchMock = stubFetch({
      "GET /api/auth/session": activeSession,
      "GET /api/subscriptions": { body: [stale] },
      "GET /api/categories": { body: ["官方订阅"] },
      "GET /api/tags": { body: [] },
      "GET /api/providers": {
        body: [
          {
            id: "moonshot",
            name: "月之暗面",
            plans: [
              {
                id: "kimi-code",
                name: "Kimi Code",
                usageApiUrl: "https://api.kimi.com/coding/v1/usages",
              },
            ],
          },
        ],
      },
      "GET /api/subscriptions/sub-1/usage": {
        body: {
          provider: "moonshot",
          fiveHour: null,
          weekly: null,
          monthly: {
            limit: "100",
            used: "10",
            remaining: "90",
            resetTime: "2099-07-15T12:00:00Z",
          },
          subscription: calibrated,
        },
      },
    });

    renderAt("/subscriptions");

    // The card renders the calibrated schedule from the list replacement.
    expect(await screen.findByText("每月15日")).toBeTruthy();

    // The calibrated values are already in the edit form (no manual refresh).
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByText("每15日")).toBeTruthy();
    expect(screen.getByText("12:00")).toBeTruthy();

    // The in-place replacement did not remount the card and re-fire its mount
    // query: exactly one usage request was made.
    const usageCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/subscriptions/sub-1/usage")
    );
    expect(usageCalls).toHaveLength(1);
    await waitFor(() => expect(usageCalls).toHaveLength(1));
  });
});
