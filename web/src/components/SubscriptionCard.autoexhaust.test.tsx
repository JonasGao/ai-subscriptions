// Parity port of __tests__/auto-exhaust.test.tsx (10 cases).
// ADR-0007: usage query auto-exhaust linkage.
//
// Deviations from the old stack:
//  - Solid signals instead of React state; props are reactive.
//  - The toggle callback is passed through the card to the parent; the card
//    itself does not own the toggle logic (same seam as the old stack).

import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionCard } from "./SubscriptionCard";
import type {
  Provider,
  Subscription,
  UsageResult,
} from "../subscriptions/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "官方订阅",
    provider: "github",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 10,
    status: "active",
    hasCredentials: true,
    planId: "copilot-free",
    resetSchedules: [],
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    ...overrides,
  };
}

function makeUsageResult(overrides: Partial<UsageResult> = {}): UsageResult {
  return {
    provider: "github",
    fiveHour: null,
    weekly: null,
    monthly: null,
    ...overrides,
  };
}

const providers: Provider[] = [
  {
    id: "github",
    name: "GitHub",
    usageApiUrl: "https://api.github.com/usage",
    plans: [
      {
        id: "copilot-free",
        name: "Copilot Free",
        usageApiUrl: "https://api.github.com/usage",
      },
    ],
  },
  {
    id: "moonshot",
    name: "月之暗面",
    balanceApiUrl: "https://api.moonshot.cn/v1/users/me/balance",
  },
];

describe("SubscriptionCard auto-exhaust on usage query", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let onScheduleToggle: ReturnType<
    typeof vi.fn<
      (subscriptionId: string, scheduleId: string, exhausted: boolean) => void
    >
  >;

  beforeEach(() => {
    onScheduleToggle = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  // Verbatim port of the old test name. The final parity pass restored the
  // percent label and progress bar to the old stack's toFixed(1) rendering.
  it("renders the usage percentage below the progress bar", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "100",
            used: "50",
            remaining: "50",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { findByText } = render(() => (
      <SubscriptionCard
        subscription={makeSubscription()}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
      />
    ));

    // Old-stack rendering: one decimal place.
    const percentElement = await findByText("50.0%");
    expect(percentElement).toBeTruthy();
  });

  it("calls onScheduleToggle when usage reaches 100% for a window", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "100",
            used: "100",
            remaining: "0",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => {
      expect(onScheduleToggle).toHaveBeenCalledWith(
        "sub-1",
        "sched-monthly",
        true
      );
    });
  });

  it("does not call onScheduleToggle when usage is below 100%", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "100",
            used: "50",
            remaining: "50",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    // Wait for query to complete
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Give time for any potential toggle calls
    await new Promise((r) => setTimeout(r, 100));

    expect(onScheduleToggle).not.toHaveBeenCalled();
  });

  it("does not call onScheduleToggle for disabled schedules", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "100",
            used: "100",
            remaining: "0",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: false, // disabled
          exhausted: false,
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));

    expect(onScheduleToggle).not.toHaveBeenCalled();
  });

  it("does not call onScheduleToggle for already-exhausted schedules", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "100",
            used: "100",
            remaining: "0",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: true, // already exhausted
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));

    expect(onScheduleToggle).not.toHaveBeenCalled();
  });

  it("handles multiple exhausted windows", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          fiveHour: {
            limit: "10",
            used: "10",
            remaining: "0",
            resetTime: "2025-01-01T05:00:00Z",
          },
          weekly: {
            limit: "50",
            used: "50",
            remaining: "0",
            resetTime: "2025-01-07T00:00:00Z",
          },
          monthly: {
            limit: "100",
            used: "100",
            remaining: "0",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-5h",
          type: "fiveHour",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-01-01T05:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
        {
          id: "sched-weekly",
          type: "weekly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-01-07T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => {
      expect(onScheduleToggle).toHaveBeenCalledTimes(3);
    });

    expect(onScheduleToggle).toHaveBeenCalledWith("sub-1", "sched-5h", true);
    expect(onScheduleToggle).toHaveBeenCalledWith(
      "sub-1",
      "sched-weekly",
      true
    );
    expect(onScheduleToggle).toHaveBeenCalledWith(
      "sub-1",
      "sched-monthly",
      true
    );
  });

  it("does not process for one-time subscriptions (balance query)", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: "moonshot",
        isAvailable: true,
        balanceInfos: [
          {
            currency: "USD",
            available: "0.00",
            total: "100",
            toppedUp: null,
            granted: null,
            used: "100",
            frozen: null,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      subscriptionType: "one-time",
      provider: "moonshot", // has balanceApiUrl so the balance query fires
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));

    // Balance query should not trigger auto-exhaust
    expect(onScheduleToggle).not.toHaveBeenCalled();
  });

  it("does not process when window limit is 0 or negative", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "0",
            used: "0",
            remaining: "0",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-02-01T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));

    expect(onScheduleToggle).not.toHaveBeenCalled();
  });

  it("toggles multiple exhausted windows sequentially, awaiting each call", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          fiveHour: {
            limit: "10",
            used: "10",
            remaining: "0",
            resetTime: "2025-01-01T05:00:00Z",
          },
          weekly: {
            limit: "50",
            used: "50",
            remaining: "0",
            resetTime: "2025-01-07T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const callOrder: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    // First (fiveHour) call stays pending until we release it; second
    // (weekly) call must NOT start until the first resolves.
    onScheduleToggle.mockImplementation(
      async (_subscriptionId: string, scheduleId: string) => {
        callOrder.push(`start:${scheduleId}`);
        if (scheduleId === "sched-5h") {
          await firstGate;
        }
        callOrder.push(`end:${scheduleId}`);
      }
    );

    const sub = makeSubscription({
      resetSchedules: [
        {
          id: "sched-5h",
          type: "fiveHour",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-01-01T05:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
        {
          id: "sched-weekly",
          type: "weekly",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-01-07T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    // First call starts and is blocked on the gate
    await waitFor(() => expect(callOrder).toContain("start:sched-5h"));
    // Second call must not have started while the first is pending
    await new Promise((r) => setTimeout(r, 50));
    expect(callOrder).toEqual(["start:sched-5h"]);

    // Release the first; the second should now run
    releaseFirst();
    await waitFor(() => expect(callOrder).toContain("end:sched-weekly"));
    expect(callOrder).toEqual([
      "start:sched-5h",
      "end:sched-5h",
      "start:sched-weekly",
      "end:sched-weekly",
    ]);
  });

  it("skips windows with no matching schedule type", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeUsageResult({
          monthly: {
            limit: "100",
            used: "100",
            remaining: "0",
            resetTime: "2025-02-01T00:00:00Z",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sub = makeSubscription({
      resetSchedules: [
        // Only has fiveHour, no monthly schedule
        {
          id: "sched-5h",
          type: "fiveHour",
          enabled: true,
          exhausted: false,
          nextResetTime: "2025-01-01T05:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    render(() => (
      <SubscriptionCard
        subscription={sub}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onScheduleToggle={onScheduleToggle}
      />
    ));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));

    expect(onScheduleToggle).not.toHaveBeenCalled();
  });
});
