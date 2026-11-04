// Parity port of __tests__/query-calibration-callback.test.tsx (2 cases):
// the usage route echoes the calibrated subscription and the card hands it to
// the list-level callback so the list can stay consistent without a refetch
// (ADR-0016, #34).

import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionCard } from "./SubscriptionCard";
import type { Provider, Subscription } from "../subscriptions/types";

const providers: Provider[] = [
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
];

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "官方订阅",
    provider: "moonshot",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 10,
    status: "active",
    planId: "kimi-code",
    hasCredentials: true,
    resetSchedules: [],
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    ...overrides,
  };
}

function makeUsageResult(overrides: Record<string, unknown> = {}) {
  return {
    provider: "moonshot",
    fiveHour: null,
    weekly: null,
    monthly: null,
    ...overrides,
  };
}

function renderCard(subscription: Subscription) {
  const onSubscriptionUpdate = vi.fn();
  render(() => (
    <SubscriptionCard
      subscription={subscription}
      providers={providers}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onStatusChange={vi.fn()}
      onSubscriptionUpdate={onSubscriptionUpdate}
    />
  ));
  return { onSubscriptionUpdate };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SubscriptionCard query-driven calibration callback", () => {
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

    const { onSubscriptionUpdate } = renderCard(makeSubscription());

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

    const { onSubscriptionUpdate } = renderCard(makeSubscription());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Give the card a microtask turn to (not) fire the callback.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubscriptionUpdate).not.toHaveBeenCalled();
  });
});
