// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, RenderResult } from "@testing-library/react";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Subscription, BalanceResult } from "@/lib/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
    provider: "moonshot",
    subscriptionType: "one-time",
    billingCycle: "monthly",
    price: 10,
    status: "active",
    hasCredentials: true,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    ...overrides,
  };
}

function makeBalanceResult(
  overrides: Partial<BalanceResult> & {
    balanceInfos?: BalanceResult["balanceInfos"];
  } = {}
): BalanceResult {
  return {
    provider: "moonshot",
    isAvailable: true,
    balanceInfos: [
      {
        currency: "USD",
        available: "10.00",
        total: null,
        toppedUp: null,
        granted: null,
        used: null,
        frozen: null,
      },
    ],
    ...overrides,
  };
}

type EditFn = (s: Subscription) => void;

function renderCard(sub: Subscription): {
  onEdit: ReturnType<typeof vi.fn<EditFn>>;
  result: RenderResult;
} {
  const onEdit = vi.fn<EditFn>();
  const result = render(
    <SubscriptionCard
      subscription={sub}
      onEdit={onEdit}
      onDelete={vi.fn<(id: string) => void>()}
      onStatusChange={vi.fn<(id: string, s: "active" | "paused") => void>()}
    />
  );
  return { onEdit, result };
}

const waitForEffects = () =>
  waitFor(() => new Promise((r) => setTimeout(r, 20)));

describe("SubscriptionCard auto-query on mount", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: "moonshot",
        isAvailable: true,
        balanceInfos: [
          {
            currency: "USD",
            available: "10.00",
            total: null,
            toppedUp: null,
            granted: null,
            used: null,
            frozen: null,
          },
        ],
      }),
    });
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("triggers a balance query on mount for active + eligible one-time subscription", async () => {
    const { onEdit } = renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: true,
        provider: "moonshot", // has balanceApiUrl
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/subscriptions/sub-1/balance");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("triggers a usage query on mount for active + eligible recurring subscription", async () => {
    renderCard(
      makeSubscription({
        subscriptionType: "recurring",
        provider: "fangzhou",
        planId: "codingplan",
        status: "active",
        hasCredentials: true,
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/subscriptions/sub-1/usage");
  });

  it("still triggers a usage query on mount for an active recurring subscription marked exhausted by reset schedule", async () => {
    renderCard(
      makeSubscription({
        subscriptionType: "recurring",
        provider: "fangzhou",
        planId: "codingplan",
        status: "active",
        hasCredentials: true,
        resetSchedules: [
          {
            id: "sched-1",
            enabled: true,
            type: "monthly",
            nextResetTime: "2026-09-01T00:00:00Z",
            exhausted: true,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/subscriptions/sub-1/usage");
  });

  it.each([
    ["paused", { status: "paused" as const }],
    ["cancelled", { status: "cancelled" as const }],
    [
      "provider/plan with no usageApiUrl or balanceApiUrl",
      {
        status: "active" as const,
        hasCredentials: true,
        provider: "anthropic",
      },
    ],
  ])("does NOT trigger a query for %s", async (_label, overrides) => {
    renderCard(makeSubscription(overrides));
    await waitForEffects();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT trigger a query and does NOT open edit dialog when hasCredentials is false", async () => {
    const { onEdit } = renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: false,
        provider: "moonshot",
      })
    );

    await waitForEffects();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("triggers the query only once on mount", async () => {
    const sub = makeSubscription({
      status: "active",
      hasCredentials: true,
      provider: "moonshot",
    });
    const { result, onEdit } = renderCard(sub);

    // Wait for the initial auto-query. One-time balance flow issues a single
    // GET /balance (server-side now persists the result; no client PUT).
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          (c) => c[0] === "/api/subscriptions/sub-1/balance"
        ).length
      ).toBe(1)
    );

    // Re-render with same subscription — should not trigger again
    result.rerender(
      <SubscriptionCard
        subscription={sub}
        onEdit={onEdit}
        onDelete={vi.fn<(id: string) => void>()}
        onStatusChange={vi.fn<(id: string, s: "active" | "paused") => void>()}
      />
    );

    await waitForEffects();
    expect(
      fetchMock.mock.calls.filter(
        (c) => c[0] === "/api/subscriptions/sub-1/balance"
      ).length
    ).toBe(1);
  });

  it("does NOT issue a client PUT write-back after balance query", async () => {
    renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: true,
        provider: "moonshot",
      })
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          (c) => c[0] === "/api/subscriptions/sub-1/balance"
        ).length
      ).toBe(1)
    );

    await waitForEffects();
    const putCalls = fetchMock.mock.calls.filter(
      (c) =>
        Array.isArray(c[1]) === false &&
        typeof c[1] === "object" &&
        (c[1] as { method?: string }).method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});

describe("SubscriptionCard balance display", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only new balance when no previous balance exists", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makeBalanceResult({
            balanceInfos: [
              {
                currency: "USD",
                available: "399.00",
                total: null,
                toppedUp: null,
                granted: null,
                used: null,
                frozen: null,
              },
            ],
          }),
      })
    );

    const { result } = renderCard(
      makeSubscription({
        balance: undefined,
        balanceCurrency: undefined,
      })
    );

    return waitFor(
      () => {
        expect(result.getByText("$399.00")).toBeTruthy();
      },
      { timeout: 1000 }
    );
  });

  it("shows new (old) comparison when balance changes", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makeBalanceResult({
            balanceInfos: [
              {
                currency: "CNY",
                available: "399.00",
                total: null,
                toppedUp: null,
                granted: null,
                used: null,
                frozen: null,
              },
            ],
          }),
      })
    );

    const { result } = renderCard(
      makeSubscription({ balance: 500, balanceCurrency: "CNY" })
    );

    return waitFor(
      () => {
        expect(result.getByText("¥399.00")).toBeTruthy();
        expect(result.getByText(/¥500\.00/)).toBeTruthy();
      },
      { timeout: 1000 }
    );
  });

  it("shows only new balance (no parenthesis) when balance equals previous", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makeBalanceResult({
            balanceInfos: [
              {
                currency: "CNY",
                available: "500.00",
                total: null,
                toppedUp: null,
                granted: null,
                used: null,
                frozen: null,
              },
            ],
          }),
      })
    );

    const { result } = renderCard(
      makeSubscription({ balance: 500, balanceCurrency: "CNY" })
    );

    return waitFor(
      () => {
        expect(result.getByText("¥500.00")).toBeTruthy();
        // No parenthesis should be present for equal balances
        const allText = result.container.textContent || "";
        expect(allText).not.toMatch(/¥500\.00\s*\(\s*¥500\.00\s*\)/);
      },
      { timeout: 1000 }
    );
  });

  it("renders USD currency symbol correctly", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makeBalanceResult({
            provider: "openrouter",
            balanceInfos: [
              {
                currency: "USD",
                available: "42.50",
                total: null,
                toppedUp: null,
                granted: null,
                used: null,
                frozen: null,
              },
            ],
          }),
      })
    );

    const { result } = renderCard(makeSubscription({ provider: "openrouter" }));

    return waitFor(
      () => {
        expect(result.getByText("$42.50")).toBeTruthy();
      },
      { timeout: 1000 }
    );
  });
});
