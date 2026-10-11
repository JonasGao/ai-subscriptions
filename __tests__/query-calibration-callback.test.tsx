// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Subscription, UsageResult } from "@/lib/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
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
    boosterWallet: null,
    parallel: null,
    membership: null,
    ...overrides,
  };
}

describe("SubscriptionCard query-driven calibration callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("calls onSubscriptionUpdate with the calibrated subscription from the usage response", async () => {
    const calibrated = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          type: "monthly",
          enabled: true,
          exhausted: false,
          timezone: "UTC",
          dayOfMonth: 15,
          timeOfDay: "12:00",
          nextResetTime: "2099-07-15T12:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-06-01T00:00:00Z",
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...makeUsageResult(),
        subscription: calibrated,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSubscriptionUpdate = vi.fn();
    render(
      <SubscriptionCard
        subscription={makeSubscription()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onSubscriptionUpdate={onSubscriptionUpdate}
      />
    );

    await waitFor(() =>
      expect(onSubscriptionUpdate).toHaveBeenCalledWith(calibrated)
    );
  });

  it("does not call onSubscriptionUpdate when the response has no subscription field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeUsageResult(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSubscriptionUpdate = vi.fn();
    render(
      <SubscriptionCard
        subscription={makeSubscription()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onSubscriptionUpdate={onSubscriptionUpdate}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Give the hook a microtask turn to (not) fire the callback.
    await new Promise((r) => setTimeout(r, 0));
    expect(onSubscriptionUpdate).not.toHaveBeenCalled();
  });
});
