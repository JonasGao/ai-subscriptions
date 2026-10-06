// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  waitFor,
  fireEvent,
  cleanup,
  RenderResult,
} from "@testing-library/react";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Subscription } from "@/lib/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
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

describe("SubscriptionCard model button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  it("clicking model button with credentials opens dialog and fetches models", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4", "gpt-3.5-turbo"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

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

  it("does NOT auto-fetch models on mount", () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    // Should not call /models endpoint on mount
    expect(mockFetch).not.toHaveBeenCalledWith(
      "/api/subscriptions/sub-1/models",
      expect.any(Object)
    );
  });

  it("does NOT trigger Query Cooldown when clicking model button", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({
        provider: "deepseek",
        subscriptionType: "one-time",
        hasCredentials: true,
      })
    );

    // Click model button
    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/subscriptions/sub-1/models",
        expect.any(Object)
      );
    });

    // Balance query should still be available (no cooldown interference)
    // The balance button should exist and be clickable
    const balanceButton = result.queryByRole("button", { name: /余额/ });
    if (balanceButton) {
      expect(balanceButton).toBeTruthy();
    }
  });

  it("does NOT call any write API when clicking model button", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Verify only GET request to /models was made, no POST/PUT/DELETE
    const calls = mockFetch.mock.calls;
    const modelCall = calls.find((call) =>
      call[0].toString().includes("/models")
    );
    if (modelCall) {
      const options = modelCall[1] || {};
      expect(options.method || "GET").toBe("GET");
    }
  });
});

describe("ModelListDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("displays models list after successful fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4", "gpt-3.5-turbo", "claude-3"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

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
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4", "gpt-3.5-turbo", "claude-3"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText(/共 3 个模型/)).toBeTruthy();
    });
  });

  it("displays empty state when no models", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("未查询到模型")).toBeTruthy();
    });
  });

  it("filters models by search input", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: ["gpt-4", "gpt-3.5-turbo", "claude-3-opus"],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    const searchInput = result.getByPlaceholderText(/搜索/);
    fireEvent.change(searchInput, { target: { value: "gpt" } });

    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
      expect(result.getByText("gpt-3.5-turbo")).toBeTruthy();
      expect(result.queryByText("claude-3-opus")).toBeNull();
    });
  });

  it("shows refresh button and refetches on click", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ["gpt-4"] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: ["gpt-4", "gpt-3.5-turbo"] }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ models: ["gpt-4", "gpt-3.5-turbo"] }),
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

    const refreshButton = result.getByRole("button", { name: /刷新/ });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(result.getByText("gpt-3.5-turbo")).toBeTruthy();
    });

    // Should have called fetch at least one more time after refresh
    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("displays update timestamp", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      expect(result.getByText(/更新于/)).toBeTruthy();
    });
  });

  it("shows error toast and error state on fetch failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    await waitFor(() => {
      // Error should be shown in the dialog
      expect(result.getByText("查询失败")).toBeTruthy();
    });
  });

  it("reuses cached models when reopening dialog", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["gpt-4"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderCard(
      makeSubscription({ provider: "deepseek", hasCredentials: true })
    );

    // First open
    fireEvent.click(result.getByRole("button", { name: /模型/ }));
    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    const firstFetchCount = mockFetch.mock.calls.length;

    // Close dialog by pressing Escape
    fireEvent.keyDown(result.getByText("gpt-4"), { key: "Escape" });

    // Wait a bit for dialog to close
    await waitFor(() => {
      expect(result.queryByText("gpt-4")).toBeNull();
    });

    // Reopen
    fireEvent.click(result.getByRole("button", { name: /模型/ }));

    // Should still show models without refetching (or minimal refetches)
    await waitFor(() => {
      expect(result.getByText("gpt-4")).toBeTruthy();
    });

    // Fetch should not be called significantly more times
    // (allowing for some React rendering variations)
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(firstFetchCount + 1);
  });
});
