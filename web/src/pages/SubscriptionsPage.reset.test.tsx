// Page-level flow for the reset-schedule surface (#27): the form creates
// schedules through both creation methods and the card toggles exhaustion
// through the toggle endpoint.

import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubFetch } from "../test-utils";
import type { ResetSchedule, Subscription } from "../subscriptions/types";

const NOW = new Date("2024-06-03T00:00:00.000Z"); // Monday

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

function scheduled(overrides: Partial<ResetSchedule> = {}): ResetSchedule {
  return {
    id: "sched-1",
    enabled: true,
    type: "weekly",
    dayOfWeek: 4,
    timeOfDay: "05:00",
    timezone: "UTC",
    nextResetTime: "2024-06-06T05:00:00.000Z",
    exhausted: false,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
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
    startDate: "2024-01-01",
    renewalDate: "2024-02-01",
    status: "active",
    resetSchedules: [scheduled()],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseStubs(subs: Subscription[]) {
  return {
    "GET /api/auth/session": activeSession,
    "GET /api/subscriptions": { body: subs },
    "GET /api/categories": { body: ["官方订阅", "中转站"] },
    "GET /api/tags": { body: [] },
    "GET /api/providers": { body: [{ id: "moonshot", name: "月之暗面" }] },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("重置计划页内流程", () => {
  it("creates a weekly schedule from an offset through the form", async () => {
    const created = subscription({
      id: "sub-new",
      name: "新订阅",
      resetSchedules: [scheduled()],
    });
    const fetchMock = stubFetch({
      ...baseStubs([]),
      "POST /api/subscriptions": { status: 201, body: created },
    });

    renderAt("/subscriptions");
    fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));
    fireEvent.input(screen.getByPlaceholderText("输入订阅名称"), {
      target: { value: "新订阅" },
    });
    fireEvent.input(screen.getByLabelText(/价格 \(¥\/月\)/), {
      target: { value: "20" },
    });
    fireEvent.input(screen.getByLabelText("开始日期 *"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.input(screen.getByLabelText("续费日期 *"), {
      target: { value: "2024-02-01" },
    });

    fireEvent.click(screen.getByRole("button", { name: "添加计划" }));
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "weekly" },
    });
    fireEvent.input(screen.getByLabelText("持续时间"), {
      target: { value: "3d 5h" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/api/subscriptions") && init?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call?.[1]?.body));
      expect(body.resetSchedules).toHaveLength(1);
      // The form infers the weekday/time in the browser's timezone; assert
      // the shape rather than a timezone-dependent wall clock (the inference
      // itself is locked in reset.test.ts with an explicit "UTC" zone).
      expect(body.resetSchedules[0]).toMatchObject({
        type: "weekly",
        enabled: true,
        exhausted: false,
      });
      expect(body.resetSchedules[0].dayOfWeek).toBeTypeOf("number");
      expect(body.resetSchedules[0].timeOfDay).toMatch(/^\d{2}:\d{2}$/);
      expect(body.resetSchedules[0].nextResetTime).toBeTruthy();
    });
  });

  it("toggles exhaustion through the schedule toggle route", async () => {
    const exhausted = subscription({
      status: "paused",
      resetSchedules: [scheduled({ exhausted: true })],
    });
    const fetchMock = stubFetch({
      ...baseStubs([subscription()]),
      "POST /api/subscriptions/sub-1/schedules/sched-1/toggle": {
        body: exhausted,
      },
    });

    renderAt("/subscriptions");
    fireEvent.click(await screen.findByRole("button", { name: "可用" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith(
            "/api/subscriptions/sub-1/schedules/sched-1/toggle"
          ) && init?.method === "POST"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ exhausted: true });
    });
    expect(await screen.findByRole("button", { name: "已用尽" })).toBeTruthy();
    expect(screen.getByText("额度用尽")).toBeTruthy();
  });
});
