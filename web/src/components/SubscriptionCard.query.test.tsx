// Parity port of the query-driven cases of __tests__/SubscriptionCard.test.tsx
// (the sub-rows docs/parity-matrix.md assigned to #28):
//   "auto-query on mount" 9 cases, "quota query cooldown" 5, "balance display" 4.
// Plus #28's own card-level guards.
//
// Deviations from the old stack:
//  - The provider catalog arrives as a prop (server-driven registry, ADR-0006)
//    instead of importing lib/types defaultProviders.
//  - React's rerender -> Solid: props are reactive, so "force a re-render" is a
//    signal change on the props object rather than a component remount.
//  - Time is driven by a fake clock for the 60s cooldown instead of Date.now
//    spying plus rerender.

import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionCard } from "./SubscriptionCard";
import type {
  BalanceResult,
  Provider,
  Subscription,
} from "../subscriptions/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "官方订阅",
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
  overrides: Partial<BalanceResult> = {}
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

const providers: Provider[] = [
  {
    id: "moonshot",
    name: "月之暗面",
    balanceApiUrl: "https://api.moonshot.cn/v1/users/me/balance",
    modelsApiUrl: "https://api.moonshot.cn/v1/models",
    plans: [
      {
        id: "kimi-code",
        name: "Kimi Code",
        usageApiUrl: "https://api.kimi.com/coding/v1/usages",
      },
    ],
  },
  {
    id: "fangzhou",
    name: "火山方舟",
    plans: [
      {
        id: "codingplan",
        name: "Coding Plan",
        usageApiUrl: "https://open.volcengineapi.com/open/GetCodingPlanUsage",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    balanceApiUrl: "https://openrouter.ai/api/v1/credits",
    modelsApiUrl: "https://openrouter.ai/api/v1/models",
  },
  { id: "anthropic", name: "Anthropic" },
];

function renderCard(sub: Subscription) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onStatusChange = vi.fn();
  const onBalanceUpdate = vi.fn();
  const onSubscriptionUpdate = vi.fn();
  const result = render(() => (
    <SubscriptionCard
      subscription={sub}
      providers={providers}
      onEdit={onEdit}
      onDelete={onDelete}
      onStatusChange={onStatusChange}
      onBalanceUpdate={onBalanceUpdate}
      onSubscriptionUpdate={onSubscriptionUpdate}
    />
  ));
  return {
    onEdit,
    onDelete,
    onBalanceUpdate,
    onSubscriptionUpdate,
    result,
  };
}

/** stubQueries answers the balance route with a fixed result and records calls. */
function stubQueries(balance: BalanceResult = makeBalanceResult()) {
  const mock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/usage")) {
        return {
          ok: true,
          json: async () => ({
            provider: "fangzhou",
            fiveHour: null,
            weekly: null,
            monthly: {
              limit: "100",
              used: "10",
              remaining: "90",
              resetTime: "2099-07-15T12:00:00Z",
            },
            subscription: null,
          }),
        };
      }
      return { ok: true, json: async () => balance };
    }
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

const settle = () => waitFor(() => new Promise((r) => setTimeout(r, 20)));
const calledUrls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map((call) => String(call[0]));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SubscriptionCard auto-query on mount", () => {
  it("triggers a balance query on mount for active + eligible one-time subscription", async () => {
    const mockFetch = stubQueries();
    const { onEdit } = renderCard(
      makeSubscription({ status: "active", hasCredentials: true, provider: "moonshot" })
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(calledUrls(mockFetch)[0]).toBe("/api/subscriptions/sub-1/balance");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("triggers a usage query on mount for active + eligible recurring subscription", async () => {
    const mockFetch = stubQueries();
    renderCard(
      makeSubscription({
        subscriptionType: "recurring",
        provider: "fangzhou",
        planId: "codingplan",
        status: "active",
        hasCredentials: true,
      })
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(calledUrls(mockFetch)[0]).toBe("/api/subscriptions/sub-1/usage");
  });

  it("still triggers a usage query on mount for an active recurring subscription marked exhausted by reset schedule", async () => {
    const mockFetch = stubQueries();
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

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(calledUrls(mockFetch)[0]).toBe("/api/subscriptions/sub-1/usage");
  });

  it.each([
    ["paused", { status: "paused" as const }],
    ["cancelled", { status: "cancelled" as const }],
    [
      "provider/plan with no usageApiUrl or balanceApiUrl",
      { status: "active" as const, hasCredentials: true, provider: "anthropic" },
    ],
  ])("does NOT trigger a query for %s", async (_label, overrides) => {
    const mockFetch = stubQueries();
    renderCard(makeSubscription(overrides));
    await settle();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT trigger a query and does NOT open edit dialog when hasCredentials is false", async () => {
    const mockFetch = stubQueries();
    const { onEdit } = renderCard(
      makeSubscription({ status: "active", hasCredentials: false, provider: "moonshot" })
    );

    await settle();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("triggers the query only once on mount", async () => {
    const mockFetch = stubQueries();
    const [subscription, setSubscription] = createSignal(
      makeSubscription({ status: "active", hasCredentials: true, provider: "moonshot" })
    );

    render(() => (
      <SubscriptionCard
        subscription={subscription()}
        providers={providers}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
      />
    ));

    // One-time balance flow issues a single GET /balance (the server persists
    // the result; there is no client PUT).
    await waitFor(
      () =>
        expect(
          calledUrls(mockFetch).filter((url) => url.endsWith("/balance")).length
        ).toBe(1),
      { timeout: 1000 }
    );

    // A downstream state change re-renders the card but must not re-query.
    setSubscription((prev) => ({ ...prev, name: "Renamed" }));
    await settle();
    expect(
      calledUrls(mockFetch).filter((url) => url.endsWith("/balance")).length
    ).toBe(1);
  });

  it("does NOT issue a client PUT write-back after balance query", async () => {
    const mockFetch = stubQueries();
    renderCard(
      makeSubscription({ status: "active", hasCredentials: true, provider: "moonshot" })
    );

    await waitFor(
      () =>
        expect(
          calledUrls(mockFetch).filter((url) => url.endsWith("/balance")).length
        ).toBe(1),
      { timeout: 1000 }
    );

    await settle();
    const putCalls = mockFetch.mock.calls.filter(
      (call) => ((call[1] ?? {}) as RequestInit).method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});

describe("SubscriptionCard quota query cooldown", () => {
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  async function renderWithCompletedAutoQuery() {
    const mockFetch = stubQueries();
    const rendered = renderCard(
      makeSubscription({ status: "active", hasCredentials: true, provider: "moonshot" })
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1), {
      timeout: 1000,
    });
    return { ...rendered, mockFetch };
  }

  it("opens confirm dialog instead of querying when clicked within 60s of the mount auto-query", async () => {
    const { result, mockFetch } = await renderWithCompletedAutoQuery();

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    expect(result.getByText("再次查询确认")).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("confirming in cooldown re-runs the query and restarts the cooldown", async () => {
    const { result, mockFetch } = await renderWithCompletedAutoQuery();

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    fireEvent.click(result.getByRole("button", { name: /确认查询/ }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // Let the confirmed query resolve and restart the cooldown window.
    await settle();

    // The confirmed query restarted the window, so clicking again prompts
    // again instead of issuing a third query.
    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    expect(result.getByText("再次查询确认")).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("cancel keeps the cooldown and does not query", async () => {
    const { result, mockFetch } = await renderWithCompletedAutoQuery();

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    fireEvent.click(result.getByRole("button", { name: /取消/ }));

    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("queries directly without confirmation once 60s have passed", async () => {
    const { result, mockFetch } = await renderWithCompletedAutoQuery();

    // Past the cooldown window.
    now += 61_000;

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(result.queryByText("再次查询确认")).toBeNull();
  });

  it("disables the quota button while a query is in flight", async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    const mockFetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ status: "active", hasCredentials: true, provider: "moonshot" })
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const button = result.getByRole("button", {
      name: /额度/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    resolveFetch!({ ok: true, json: async () => makeBalanceResult() });
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});

describe("SubscriptionCard balance display", () => {
  it("shows only new balance when no previous balance exists", async () => {
    stubQueries(
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
      })
    );

    const { result } = renderCard(
      makeSubscription({ balance: undefined, balanceCurrency: undefined })
    );

    await waitFor(() => expect(result.getByText("$399.00")).toBeTruthy(), {
      timeout: 1000,
    });
  });

  it("shows new (old) comparison when balance changes", async () => {
    stubQueries(
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
      })
    );

    const { result } = renderCard(
      makeSubscription({ balance: 500, balanceCurrency: "CNY" })
    );

    await waitFor(
      () => {
        expect(result.getByText("¥399.00")).toBeTruthy();
        expect(result.getByText(/¥500\.00/)).toBeTruthy();
      },
      { timeout: 1000 }
    );
  });

  it("shows only new balance (no parenthesis) when balance equals previous", async () => {
    stubQueries(
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
      })
    );

    const { result } = renderCard(
      makeSubscription({ balance: 500, balanceCurrency: "CNY" })
    );

    await waitFor(
      () => {
        expect(result.getByText("¥500.00")).toBeTruthy();
        const allText = result.container.textContent ?? "";
        expect(allText).not.toMatch(/¥500\.00\s*（\s*¥500\.00\s*）/);
      },
      { timeout: 1000 }
    );
  });

  it("renders USD currency symbol correctly", async () => {
    stubQueries(
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
      })
    );

    const { result } = renderCard(makeSubscription({ provider: "openrouter" }));

    await waitFor(() => expect(result.getByText("$42.50")).toBeTruthy(), {
      timeout: 1000,
    });
  });
});

describe("SubscriptionCard query guards", () => {
  it("hides the quota button for a provider without a query endpoint", () => {
    const { result } = renderCard(
      makeSubscription({ provider: "anthropic", hasCredentials: true })
    );
    expect(result.queryByRole("button", { name: /额度/ })).toBeNull();
  });

  it("routes to the edit dialog instead of querying when credentials are missing", () => {
    stubQueries();
    const { onEdit, result } = renderCard(
      makeSubscription({ provider: "moonshot", hasCredentials: false })
    );

    fireEvent.click(result.getByRole("button", { name: /额度/ }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit.mock.calls[0][0].id).toBe("sub-1");
  });

  it("chooses the usage route for recurring and balance for one-time by planId", async () => {
    const recurring = stubQueries();
    renderCard(
      makeSubscription({
        subscriptionType: "recurring",
        provider: "moonshot",
        planId: "kimi-code",
      })
    );
    await waitFor(() => expect(recurring).toHaveBeenCalled());
    expect(calledUrls(recurring)[0]).toBe("/api/subscriptions/sub-1/usage");
    cleanup();

    const oneTime = stubQueries();
    renderCard(
      makeSubscription({ subscriptionType: "one-time", provider: "moonshot" })
    );
    await waitFor(() => expect(oneTime).toHaveBeenCalled());
    expect(calledUrls(oneTime)[0]).toBe("/api/subscriptions/sub-1/balance");
  });

  it("reports a failed query inline and shows the server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => ({ error: "Moonshot API returned 401" }),
      }))
    );

    const { result } = renderCard(
      makeSubscription({ provider: "moonshot", hasCredentials: true })
    );

    await waitFor(() =>
      expect(result.getByText("Moonshot API returned 401")).toBeTruthy()
    );
  });

  it("surfaces the fresh balance to the list through onBalanceUpdate", async () => {
    stubQueries(
      makeBalanceResult({
        balanceInfos: [
          {
            currency: "CNY",
            available: "321.00",
            total: null,
            toppedUp: null,
            granted: null,
            used: null,
            frozen: null,
          },
        ],
      })
    );

    const { onBalanceUpdate } = renderCard(
      makeSubscription({ provider: "moonshot", hasCredentials: true })
    );

    await waitFor(() =>
      expect(onBalanceUpdate).toHaveBeenCalledWith("sub-1", 321, "CNY")
    );
  });
});
