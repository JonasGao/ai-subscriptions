import { describe, expect, it } from "vitest";
import {
  deriveStatus,
  explainStatus,
  resolveStatus,
} from "@/lib/status-policy";
import type { Subscription } from "@/lib/types";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "测试订阅",
    category: "AI助手",
    provider: "openai",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("status policy", () => {
  it("keeps cancelled status and explains it as manual", () => {
    expect(resolveStatus(makeSubscription({ status: "cancelled" }))).toEqual({
      status: "cancelled",
      reason: { kind: "manual-cancelled" },
    });
  });

  it("derives paused status from enabled exhausted schedules", () => {
    const subscription = makeSubscription({
      resetSchedules: [
        {
          id: "schedule-1",
          enabled: true,
          type: "monthly",
          nextResetTime: "2024-02-01T00:00:00Z",
          exhausted: true,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    });

    expect(deriveStatus(subscription)).toBe("paused");
    expect(explainStatus(subscription)).toEqual({
      kind: "schedule-exhausted",
      scheduleIds: ["schedule-1"],
    });
  });

  it("restores active when no enabled schedule is exhausted", () => {
    const subscription = makeSubscription({ status: "paused" });

    expect(resolveStatus(subscription)).toEqual({
      status: "active",
      reason: { kind: "manual-paused" },
    });
  });
});
