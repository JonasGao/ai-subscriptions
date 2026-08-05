import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Use a temp directory for each test run so we don't touch the real data.
let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sub-test-"));
  process.env.DATA_DIR = tempDataDir;
  // Reset module cache so db.ts picks up the new DATA_DIR.
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

// Dynamic imports after setting DATA_DIR.
async function getDb() {
  return await import("@/lib/db");
}

import type { Subscription, SubscriptionData } from "@/lib/types";

function makeData(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    subscriptions: [],
    categories: [],
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Active Sub",
    category: "AI助手",
    provider: "openai",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    resetSchedules: [
      {
        id: "sched-1",
        enabled: true,
        type: "monthly",
        nextResetTime: "2024-01-01T00:00:00Z",
        exhausted: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("processResetTick filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T01:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT produce triggers for cancelled subscriptions", async () => {
    const db = await getDb();
    const data = makeData({
      subscriptions: [
        makeSubscription({ name: "Cancelled Sub", status: "cancelled" }),
      ],
    });
    db.writeData(data);
    const triggers = db.processResetTick();
    expect(triggers).toHaveLength(0);
  });

  it("does NOT produce triggers for disabled schedules", async () => {
    const db = await getDb();
    const data = makeData({
      subscriptions: [
        makeSubscription({
          resetSchedules: [
            {
              id: "sched-1",
              enabled: false,
              type: "monthly",
              nextResetTime: "2024-01-01T00:00:00Z",
              exhausted: false,
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        }),
      ],
    });
    db.writeData(data);
    const triggers = db.processResetTick();
    expect(triggers).toHaveLength(0);
  });

  it("does NOT produce triggers when schedule was not exhausted", async () => {
    const db = await getDb();
    const data = makeData({
      subscriptions: [
        makeSubscription({
          resetSchedules: [
            {
              id: "sched-1",
              enabled: true,
              type: "monthly",
              dayOfMonth: 15,
              timeOfDay: "10:00",
              nextResetTime: "2024-01-01T00:00:00Z",
              exhausted: false,
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        }),
      ],
    });
    db.writeData(data);
    const triggers = db.processResetTick();
    // Schedule was already available — no notification needed.
    expect(triggers).toHaveLength(0);
    // But the schedule should still have been advanced.
    const saved = db.getSubscriptions();
    expect(
      new Date(saved[0].resetSchedules![0].nextResetTime).getTime()
    ).toBeGreaterThan(new Date("2024-06-01T01:00:00Z").getTime());
  });

  it("produces a trigger when an exhausted schedule resets", async () => {
    const db = await getDb();
    const data = makeData({
      subscriptions: [
        makeSubscription({
          resetSchedules: [
            {
              id: "sched-1",
              enabled: true,
              type: "monthly",
              dayOfMonth: 15,
              timeOfDay: "10:00",
              nextResetTime: "2024-01-01T00:00:00Z",
              exhausted: true,
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        }),
      ],
    });
    db.writeData(data);
    const triggers = db.processResetTick();
    expect(triggers).toHaveLength(1);
    expect(triggers[0].subscriptionId).toBe("sub-1");
    expect(triggers[0].scheduleType).toBe("monthly");
    // nextResetTime should be advanced to the next monthly occurrence.
    expect(new Date(triggers[0].nextResetTime).getTime()).toBeGreaterThan(
      new Date("2024-06-01T01:00:00Z").getTime()
    );
    // Schedule should now be marked as not exhausted.
    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].exhausted).toBe(false);
  });
});
