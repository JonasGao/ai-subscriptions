// Parity port of __tests__/model-button.test.tsx (18 cases, two describes:
// "SubscriptionCard model button" 10 + "ModelListDialog" 8).
//
// Deviations from the old stack:
//  - The card takes the provider catalog as a prop (the server-driven registry,
//    ADR-0006) instead of importing lib/types defaultProviders, so each test
//    supplies the providers it needs.
//  - No toast library exists yet (#40 page shell); the dialog's inline error
//    state is asserted instead.
//  - React's fireEvent.change/fireEvent.keyDown map onto Solid's onInput/onKeyDown
//    with unchanged assertions.

import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionCard } from "./SubscriptionCard";
import type { Provider, Subscription } from "../subscriptions/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "官方订阅",
    provider: "deepseek",
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

/** The provider slice of the registry the card needs (mirrors /api/providers). */
const providers: Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    balanceApiUrl: "https://api.deepseek.com/user/balance",
    modelsApiUrl: "https://api.deepseek.com/models",
  },
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
        modelsApiUrl: "https://api.kimi.com/coding/v1/models",
      },
    ],
  },
  {
    id: "alibaba",
    name: "阿里云百炼",
    plans: [
      {
        id: "coding-plan",
        name: "Coding Plan",
        modelsApiUrl: "https://coding.dashscope.aliyuncs.com/v1/models",
        modelsRequireCredentials: false,
      },
      {
        id: "token-plan",
        name: "Token Plan",
        usageApiUrl:
          "https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/seat-detail",
        modelsApiUrl:
          "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models",
      },
    ],
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
  return { onEdit, onDelete, onStatusChange, onBalanceUpdate, result };
}

function stubModels(models: string[] | (() => unknown)) {
  const mock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => (typeof models === "function" ? models() : { models }),
    })
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SubscriptionCard model button", () => {
  it("shows model button when provider has modelsApiUrl", () => {
    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );
    expect(result.getByRole("button", { name: /模型/ })).toBeTruthy();
  });

  it("shows model button when plan has modelsApiUrl override", () => {
    const { result } = renderCard(
      makeSubscription({
        provider: "moonshot",
        planId: "kimi-code",
        hasCredentials: true,
      })
    );
    expect(result.getByRole("button", { name: /模型/ })).toBeTruthy();
  });

  it("hides model button when provider has no modelsApiUrl", () => {
    const { result } = renderCard(
      makeSubscription({ provider: "anthropic", hasCredentials: true })
    );
    expect(result.queryByRole("button", { name: /模型/ })).toBeNull();
  });

  it("clicking model button without credentials triggers onEdit", () => {
    const { onEdit, result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: false })
    );
    fireEvent.click(result.getByRole("button", { name: /模型/ }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("clicking model button without credentials opens dialog for public endpoints (alibaba coding-plan)", async () => {
    const mockFetch = stubModels(["qwen3-coder-plus", "glm-5"]);

    const { onEdit, result } = renderCard(
      makeSubscription({
        provider: "alibaba",
        planId: "coding-plan",
        subscriptionType: "recurring",
        hasCredentials: false,
      })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    expect(onEdit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/subscriptions/sub-1/models",
        expect.any(Object)
      );
    });
  });

  it("clicking model button without credentials still triggers onEdit for alibaba token-plan (auth required)", () => {
    const { onEdit, result } = renderCard(
      makeSubscription({
        provider: "alibaba",
        planId: "token-plan",
        subscriptionType: "recurring",
        hasCredentials: false,
      })
    );
    fireEvent.click(result.getByRole("button", { name: /模型/ }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("clicking model button with credentials opens dialog and fetches models", async () => {
    const mockFetch = stubModels(["gpt-4", "gpt-3.5-turbo"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/subscriptions/sub-1/models",
        expect.any(Object)
      );
    });
  });

  it("does NOT auto-fetch models on mount", async () => {
    const mockFetch = stubModels(["gpt-4"]);

    renderCard(makeSubscription({ provider: "deepseek", hasCredentials: true }));

    await waitFor(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(mockFetch).not.toHaveBeenCalledWith(
      "/api/subscriptions/sub-1/models",
      expect.any(Object)
    );
  });

  it("does NOT trigger Query Cooldown when clicking model button", async () => {
    const mockFetch = stubModels(["gpt-4"]);

    const { result } = renderCard(
      makeSubscription({
        provider: "deepseek",
        subscriptionType: "one-time",
        hasCredentials: true,
      })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/subscriptions/sub-1/models",
        expect.any(Object)
      );
    });

    // The balance query is still available (no cooldown interference).
    const balanceButton = result.queryByRole("button", { name: /额度/ });
    expect(balanceButton).toBeTruthy();
  });

  it("does NOT call any write API when clicking model button", async () => {
    const mockFetch = stubModels(["gpt-4"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const modelCall = mockFetch.mock.calls.find((call) =>
      String(call[0]).includes("/models")
    );
    const options = (modelCall?.[1] ?? {}) as RequestInit;
    expect(options.method ?? "GET").toBe("GET");
  });
});

describe("ModelListDialog", () => {
  it("displays models list after successful fetch", async () => {
    stubModels(["gpt-4", "gpt-3.5-turbo", "claude-3"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
      expect(result.getByText("gpt-3.5-turbo")).toBeTruthy();
      expect(result.getByText("claude-3")).toBeTruthy();
    });
  });

  it("displays total count", async () => {
    stubModels(["gpt-4", "gpt-3.5-turbo", "claude-3"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText(/共 3 个模型/)).toBeTruthy();
    });
  });

  it("displays empty state when no models", async () => {
    stubModels([]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("未查询到模型")).toBeTruthy();
    });
  });

  it("filters models by search input", async () => {
    stubModels(["gpt-4", "gpt-3.5-turbo", "claude-3-opus"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    const searchInput = result.getByPlaceholderText(/搜索/);
    fireEvent.input(searchInput, { target: { value: "gpt" } });

    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
      expect(result.getByText("gpt-3.5-turbo")).toBeTruthy();
      expect(result.queryByText("claude-3-opus")).toBeNull();
    });
  });

  it("shows refresh button and refetches on click", async () => {
    let call = 0;
    const mockFetch = vi.fn(async () => {
      call += 1;
      return {
        ok: true,
        json: async () => ({
          models: call === 1 ? ["gpt-4"] : ["gpt-4", "gpt-3.5-turbo"],
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    const initialCallCount = mockFetch.mock.calls.length;

    fireEvent.click(result.getByRole("button", { name: /刷新/ }));

    await waitFor(() => {
      expect(result.getByText("gpt-3.5-turbo")).toBeTruthy();
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("displays update timestamp", async () => {
    stubModels(["gpt-4"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText(/更新于/)).toBeTruthy();
    });
  });

  it("shows error state on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      }))
    );

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("查询失败")).toBeTruthy();
    });
  });

  it("reuses cached models when reopening dialog", async () => {
    const mockFetch = stubModels(["gpt-4"]);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    // First open
    fireEvent.click(result.getByRole("button", { name: /模型/ }));
    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    const firstFetchCount = mockFetch.mock.calls.length;

    // Close the dialog with Escape
    fireEvent.keyDown(result.getByText("gpt-4"), { key: "Escape" });
    await waitFor(() => {
      expect(result.queryByText("gpt-4")).toBeNull();
    });

    // Reopen — the session cache answers without another request.
    fireEvent.click(result.getByRole("button", { name: /模型/ }));
    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(
      firstFetchCount + 1
    );
  });
});
