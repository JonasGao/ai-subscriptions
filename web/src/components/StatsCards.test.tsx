import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { StatsCards } from "./StatsCards";
import type { Subscription } from "../subscriptions/types";

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test",
    category: "官方订阅",
    provider: "moonshot",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    ...overrides,
  };
}

afterEach(cleanup);

describe("StatsCards", () => {
  it("computes monthly, yearly and one-time totals from the visible subscriptions", () => {
    render(() => (
      <StatsCards
        subscriptions={[
          subscription({ id: "m", price: 20 }),
          subscription({ id: "y", billingCycle: "yearly", price: 120 }),
          subscription({
            id: "t1",
            subscriptionType: "one-time",
            price: 0,
            balance: 50,
          }),
          subscription({
            id: "t2",
            subscriptionType: "one-time",
            price: 0,
            balance: 30,
          }),
        ]}
      />
    ));

    // Monthly = 20 + 120/12 = 30; yearly = 20*12 + 120 = 360.
    // One-time subscriptions carry price 0; the stat sums their balance (#3195007).
    expect(screen.getByText("¥30.00")).toBeTruthy();
    expect(screen.getByText("¥360.00")).toBeTruthy();
    expect(screen.getByText("¥80.00")).toBeTruthy();
    expect(screen.getByText("周期性订阅 (2个)")).toBeTruthy();
    expect(screen.getByText("活跃充值 (2个)")).toBeTruthy();
    expect(screen.getByText("周期性 2 · 一次性 2")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders zero totals for an empty list", () => {
    render(() => <StatsCards subscriptions={[]} />);
    expect(screen.getAllByText("¥0.00")).toHaveLength(3);
    expect(screen.getByText("周期性 0 · 一次性 0")).toBeTruthy();
  });
});
