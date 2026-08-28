// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  waitFor,
  fireEvent,
  cleanup,
  RenderResult,
} from "@testing-library/react";
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
  onDelete: ReturnType<typeof vi.fn<(id: string) => void>>;
  result: RenderResult;
} {
  const onEdit = vi.fn<EditFn>();
  const onDelete = vi.fn<(id: string) => void>();
  const result = render(
    <SubscriptionCard
      subscription={sub}
      onEdit={onEdit}
      onDelete={onDelete}
      onStatusChange={vi.fn<(id: string, s: "active" | "paused") => void>()}
    />
  );
  return { onEdit, onDelete, result };
}

const waitForEffects = () =>
  waitFor(() => new Promise((r) => setTimeout(r, 20)));

describe("SubscriptionCard deletion confirmation", () => {
  afterEach(() => {
    cleanup();
  });

  it("requires two confirmations before deleting a subscription", () => {
    const { onDelete, result } = renderCard(makeSubscription());

    fireEvent.click(result.getByRole("button", { name: "删除" }));
    expect(result.getByText("确认删除订阅")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(result.getByRole("button", { name: "继续删除" }));
    expect(result.getByText("再次确认删除")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(result.getByRole("button", { name: "确认删除" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("sub-1");
  });

  it("cancelling the confirmation does not delete the subscription", () => {
    const { onDelete, result } = renderCard(makeSubscription());

    fireEvent.click(result.getByRole("button", { name: "删除" }));
    fireEvent.click(result.getByRole("button", { name: "取消" }));

    expect(result.queryByText("确认删除订阅")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("SubscriptionCard tags", () => {
  afterEach(cleanup);

  it("renders tags in the subscription association order", () => {
    const subscription = makeSubscription({
      tagIds: ["second", "first"],
    });
    const result = render(
      <SubscriptionCard
        subscription={subscription}
        tags={[
          {
            id: "first",
            name: "稳定",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
          {
            id: "second",
            name: "质量高",
            createdAt: "2026-01-02",
            updatedAt: "2026-01-02",
          },
        ]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
      />
    );

    const labels = result.getAllByText(/质量高|稳定/);
    expect(labels.map((label) => label.textContent)).toEqual([
      "质量高",
      "稳定",
    ]);
  });
});

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

describe("SubscriptionCard quota query cooldown", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let now: number;

  beforeEach(() => {
    // RTL auto-cleanup does not run with vitest globals:false — clear DOM
    // accumulated by earlier describe blocks in this file.
    cleanup();
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeBalanceResult({
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
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens confirm dialog instead of querying when clicked within 60s of the mount auto-query", async () => {
    const { result } = renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: true,
        provider: "moonshot",
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    expect(result.getByText("再次查询确认")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("confirming in cooldown re-runs the query and restarts the cooldown", async () => {
    const { result } = renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: true,
        provider: "moonshot",
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    fireEvent.click(result.getByRole("button", { name: /确认查询/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The confirmed query restarted the cooldown, so clicking again prompts
    // again without an immediate third query.
    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    expect(result.getByText("再次查询确认")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancel keeps the cooldown and does not query", async () => {
    const { result } = renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: true,
        provider: "moonshot",
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    fireEvent.click(result.getByRole("button", { name: /取消/ }));

    await waitForEffects();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queries directly without confirmation once 60s have passed", async () => {
    const sub = makeSubscription({
      status: "active",
      hasCredentials: true,
      provider: "moonshot",
    });
    const { result, onEdit } = renderCard(sub);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Advance time past the cooldown and force a re-render
    now = 61_000;
    result.rerender(
      <SubscriptionCard
        subscription={sub}
        onEdit={onEdit}
        onDelete={vi.fn<(id: string) => void>()}
        onStatusChange={vi.fn<(id: string, s: "active" | "paused") => void>()}
      />
    );

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.queryByText("再次查询确认")).toBeNull();
  });

  it("disables the quota button while a query is in flight", async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const { result } = renderCard(
      makeSubscription({
        status: "active",
        hasCredentials: true,
        provider: "moonshot",
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const button = result.getByRole("button", {
      name: /额度/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    resolveFetch({
      ok: true,
      json: async () => makeBalanceResult(),
    });
    await waitFor(() => expect(button.disabled).toBe(false));
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
