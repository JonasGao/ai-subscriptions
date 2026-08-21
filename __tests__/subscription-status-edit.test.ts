import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

async function getDeps() {
  const db = await import("@/lib/db");
  const route = await import("@/app/api/subscriptions/[id]/route");
  const { NextRequest } = await import("next/server");
  return { db, route, NextRequest };
}

describe("subscription status edit (cancel → pause)", () => {
  it("keeps an explicitly chosen active status even with exhausted schedules", async () => {
    const { db, route, NextRequest } = await getDeps();
    const sub = db.createSubscription({
      name: "测试订阅",
      category: "AI助手",
      provider: "openai",
      subscriptionType: "recurring",
      billingCycle: "monthly",
      price: 20,
      status: "paused",
      resetSchedules: [
        {
          id: "sched-1",
          enabled: true,
          type: "monthly",
          nextResetTime: "2026-09-01T00:00:00Z",
          exhausted: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const req = new NextRequest(
      `http://localhost/api/subscriptions/${sub.id}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "active" }),
      }
    );

    const res = await route.PUT(req, { params: { id: sub.id } });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("active");
    expect(db.getSubscriptionById(sub.id)?.status).toBe("active");
  });

  it("keeps the manually chosen status after saving the edit form", async () => {
    const { db, route, NextRequest } = await getDeps();

    // A cancelled subscription with no reset schedules.
    const sub = db.createSubscription({
      name: "测试订阅",
      category: "AI助手",
      provider: "openai",
      subscriptionType: "recurring",
      billingCycle: "monthly",
      price: 20,
      status: "cancelled",
    });

    // The edit form submits the whole SubscriptionFormData, which always
    // includes resetSchedules ([] when none) alongside the chosen status.
    const body = { ...sub, status: "paused", resetSchedules: [] };

    const req = new NextRequest(
      `http://localhost/api/subscriptions/${sub.id}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    );

    const res = await route.PUT(req, { params: { id: sub.id } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("paused");

    const stored = db.getSubscriptionById(sub.id);
    expect(stored?.status).toBe("paused");
  });

  it("keeps the chosen status even when the subscription has healthy schedules", async () => {
    const { db, route, NextRequest } = await getDeps();

    // The original scenario: a cancelled subscription with an enabled,
    // non-exhausted monthly schedule.
    const sub = db.createSubscription({
      name: "测试订阅",
      category: "AI助手",
      provider: "openai",
      subscriptionType: "recurring",
      billingCycle: "monthly",
      price: 20,
      status: "cancelled",
      resetSchedules: [
        {
          id: "sched-1",
          enabled: true,
          type: "monthly",
          nextResetTime: "2026-09-01T00:00:00Z",
          exhausted: false,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const body = {
      ...sub,
      status: "paused",
      resetSchedules: sub.resetSchedules,
    };

    const req = new NextRequest(
      `http://localhost/api/subscriptions/${sub.id}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    );

    const res = await route.PUT(req, { params: { id: sub.id } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("paused");

    const stored = db.getSubscriptionById(sub.id);
    expect(stored?.status).toBe("paused");
  });

  it("still recomputes status when only schedules change", async () => {
    const { db, route, NextRequest } = await getDeps();

    // A subscription that was paused by an exhausted schedule; the user
    // edits schedules without touching status.
    const sub = db.createSubscription({
      name: "测试订阅",
      category: "AI助手",
      provider: "openai",
      subscriptionType: "recurring",
      billingCycle: "monthly",
      price: 20,
      status: "paused",
      resetSchedules: [
        {
          id: "sched-1",
          enabled: true,
          type: "monthly",
          nextResetTime: "2026-09-01T00:00:00Z",
          exhausted: true,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    });

    // Schedules change (exhausted → not), status field omitted — the
    // recompute branch must still fire and restore availability.
    const body = {
      name: sub.name,
      category: sub.category,
      provider: sub.provider,
      subscriptionType: sub.subscriptionType,
      billingCycle: sub.billingCycle,
      price: sub.price,
      resetSchedules: [
        {
          id: "sched-1",
          enabled: true,
          type: "monthly",
          nextResetTime: "2026-09-01T00:00:00Z",
          exhausted: false,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ],
    };

    const req = new NextRequest(
      `http://localhost/api/subscriptions/${sub.id}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    );

    const res = await route.PUT(req, { params: { id: sub.id } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("active");

    const stored = db.getSubscriptionById(sub.id);
    expect(stored?.status).toBe("active");
  });
});
