// Parity port of the rendering baseline of __tests__/SubscriptionCard.test.tsx.
// The query-driven cases (auto-query on mount 9, quota cooldown 5, balance
// display 4) stay with the query tickets; see docs/parity-matrix.md.

import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionCard } from "./SubscriptionCard";
import type { Provider, Subscription, Tag } from "../subscriptions/types";

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

const providers: Provider[] = [
  {
    id: "moonshot",
    name: "月之暗面",
    plans: [{ id: "kimi-code", name: "Kimi Code" }],
  },
  { id: "openai", name: "OpenAI" },
];

function renderCard(sub: Subscription, tags: Tag[] = []) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onStatusChange = vi.fn();
  const result = render(() => (
    <SubscriptionCard
      subscription={sub}
      tags={tags}
      providers={providers}
      onEdit={onEdit}
      onDelete={onDelete}
      onStatusChange={onStatusChange}
    />
  ));
  return { onEdit, onDelete, onStatusChange, result };
}

describe("SubscriptionCard deletion confirmation", () => {
  afterEach(cleanup);

  it("moves focus into the dialog and returns it on Escape", async () => {
    const { result } = renderCard(makeSubscription());

    const trigger = result.getByRole("button", { name: "删除" });
    trigger.focus();
    fireEvent.click(trigger);

    // Focus lands on the first button inside the dialog (取消); the hook
    // focuses in a microtask, once the dialog is attached.
    await Promise.resolve();
    expect(document.activeElement?.textContent).toBe("取消");

    fireEvent.keyDown(result.getByText("确认删除订阅"), {
      key: "Escape",
    });
    expect(result.queryByText("确认删除订阅")).toBeNull();
    // The removal observer restores focus in its own microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
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

describe("SubscriptionCard baseline rendering", () => {
  afterEach(cleanup);

  it("renders identity, provider, plan, category, type, price and status", () => {
    const { result } = renderCard(
      makeSubscription({
        subscriptionType: "recurring",
        billingCycle: "yearly",
        price: 120,
        planId: "kimi-code",
        notes: "月度额度",
      })
    );

    expect(result.getByRole("heading", { name: "Test Sub" })).toBeTruthy();
    expect(result.getByText("月之暗面")).toBeTruthy();
    expect(result.getByText("Kimi Code")).toBeTruthy();
    expect(result.getByText("官方订阅")).toBeTruthy();
    expect(result.getByText("周期性")).toBeTruthy();
    expect(result.getByText("¥120.00/年")).toBeTruthy();
    expect(result.getByText("活跃")).toBeTruthy();
    expect(result.getByText("月度额度")).toBeTruthy();
    expect(result.getByRole("button", { name: "编辑" })).toBeTruthy();
  });

  it("labels one-time subscriptions as a top-up amount", () => {
    const { result } = renderCard(makeSubscription({ price: 39.5 }));
    expect(result.getByText("充值金额")).toBeTruthy();
    expect(result.getByText("¥39.50")).toBeTruthy();
  });

  it("shows the exhausted marker for an enabled exhausted schedule", () => {
    const { result } = renderCard(
      makeSubscription({
        subscriptionType: "recurring",
        resetSchedules: [
          {
            id: "sched-1",
            enabled: true,
            type: "monthly",
            nextResetTime: "2026-09-01T00:00:00.000Z",
            exhausted: true,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      })
    );
    expect(result.getByText("额度用尽")).toBeTruthy();
  });

  it("toggles status through the badge", () => {
    const { onStatusChange, result } = renderCard(makeSubscription());
    fireEvent.click(result.getByRole("button", { name: "活跃" }));
    expect(onStatusChange).toHaveBeenCalledWith("sub-1", "paused");
  });
});

describe("SubscriptionCard tags", () => {
  afterEach(cleanup);

  it("renders tags in the subscription association order", () => {
    const { result } = renderCard(
      makeSubscription({ tagIds: ["second", "first"] }),
      [
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
      ]
    );

    const labels = result.getAllByText(/质量高|稳定/);
    expect(labels.map((label) => label.textContent)).toEqual([
      "质量高",
      "稳定",
    ]);
  });
});
