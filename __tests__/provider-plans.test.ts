import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sub-test-"));
  process.env.DATA_DIR = tempDataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function getDb() {
  return await import("@/lib/db");
}

async function getMigrations() {
  return await import("@/lib/migrations");
}

import type { Subscription, SubscriptionData, Provider } from "@/lib/types";
import {
  resolveUsageHandlerKey,
  resolveUsageApiUrl,
  usageHandlers,
} from "@/lib/providers";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
    provider: "other",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 10,
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============ resolvePlanId ============

describe("resolvePlanId", () => {
  it("clears planId for one-time subscriptions", async () => {
    const db = await getDb();
    expect(
      db.resolvePlanId("fangzhou", "one-time", "codingplan")
    ).toBeUndefined();
    expect(db.resolvePlanId("moonshot", "one-time")).toBeUndefined();
  });

  it("returns undefined for providers with no plans", async () => {
    const db = await getDb();
    expect(db.resolvePlanId("openai", "recurring")).toBeUndefined();
    expect(db.resolvePlanId("other", "recurring")).toBeUndefined();
  });

  it("auto-fills single plan (moonshot → kimi-code)", async () => {
    const db = await getDb();
    expect(db.resolvePlanId("moonshot", "recurring")).toBe("kimi-code");
    expect(db.resolvePlanId("moonshot", "recurring", undefined)).toBe(
      "kimi-code"
    );
  });

  it("keeps explicit planId for single-plan provider", async () => {
    const db = await getDb();
    expect(db.resolvePlanId("moonshot", "recurring", "kimi-code")).toBe(
      "kimi-code"
    );
  });

  it("throws for multi-plan provider without planId", async () => {
    const db = await getDb();
    expect(() => db.resolvePlanId("fangzhou", "recurring")).toThrow(
      /planId is required/
    );
  });

  it("keeps explicit planId for multi-plan provider", async () => {
    const db = await getDb();
    expect(db.resolvePlanId("fangzhou", "recurring", "codingplan")).toBe(
      "codingplan"
    );
    expect(db.resolvePlanId("fangzhou", "recurring", "agentplan")).toBe(
      "agentplan"
    );
  });

  it("throws for invalid planId", async () => {
    const db = await getDb();
    expect(() =>
      db.resolvePlanId("fangzhou", "recurring", "nonexistent")
    ).toThrow(/not found/);
  });

  it("throws for alibaba multi-plan provider without planId", async () => {
    const db = await getDb();
    expect(() => db.resolvePlanId("alibaba", "recurring")).toThrow(
      /planId is required/
    );
  });

  it("keeps explicit planId for alibaba multi-plan provider", async () => {
    const db = await getDb();
    expect(db.resolvePlanId("alibaba", "recurring", "coding-plan")).toBe(
      "coding-plan"
    );
    expect(db.resolvePlanId("alibaba", "recurring", "token-plan")).toBe(
      "token-plan"
    );
  });
});

// ============ createSubscription plan resolution ============

describe("createSubscription plan resolution", () => {
  it("auto-fills planId for single-plan provider", async () => {
    const db = await getDb();
    const sub = db.createSubscription(
      makeSubscription({
        provider: "moonshot",
        subscriptionType: "recurring",
        billingCycle: "monthly",
      })
    );
    expect(sub.planId).toBe("kimi-code");
  });

  it("clears planId for one-time subscriptions", async () => {
    const db = await getDb();
    const sub = db.createSubscription(
      makeSubscription({
        provider: "moonshot",
        subscriptionType: "one-time",
        planId: "kimi-code",
      })
    );
    expect(sub.planId).toBeUndefined();
  });

  it("throws for multi-plan provider without planId", async () => {
    const db = await getDb();
    expect(() =>
      db.createSubscription(
        makeSubscription({
          provider: "fangzhou",
          subscriptionType: "recurring",
        })
      )
    ).toThrow(/planId is required/);
  });

  it("keeps explicit planId for multi-plan provider", async () => {
    const db = await getDb();
    const sub = db.createSubscription(
      makeSubscription({
        provider: "fangzhou",
        subscriptionType: "recurring",
        planId: "codingplan",
      })
    );
    expect(sub.planId).toBe("codingplan");
  });
});

// ============ updateSubscription plan resolution ============

describe("updateSubscription plan resolution", () => {
  it("clears planId when switching to one-time", async () => {
    const db = await getDb();
    const created = db.createSubscription(
      makeSubscription({
        provider: "moonshot",
        subscriptionType: "recurring",
      })
    );
    expect(created.planId).toBe("kimi-code");

    const updated = db.updateSubscription(created.id, {
      subscriptionType: "one-time",
    });
    expect(updated!.planId).toBeUndefined();
  });

  it("auto-fills planId when switching provider to single-plan", async () => {
    const db = await getDb();
    const created = db.createSubscription(
      makeSubscription({
        provider: "openai",
        subscriptionType: "recurring",
      })
    );
    expect(created.planId).toBeUndefined();

    const updated = db.updateSubscription(created.id, {
      provider: "moonshot",
    });
    expect(updated!.planId).toBe("kimi-code");
  });
});

// ============ Startup migration ============

describe("migrateProviderPlans", () => {
  it("rewrites fangzhou-codingplan → fangzhou + planId", async () => {
    const data: SubscriptionData = {
      subscriptions: [
        {
          ...makeSubscription({ id: "sub-1", provider: "fangzhou-codingplan" }),
        },
      ],
      categories: [],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(data)
    );

    const migrations = await getMigrations();
    migrations.migrateProviderPlans();

    const result = JSON.parse(
      fs.readFileSync(path.join(tempDataDir, "subscriptions.json"), "utf-8")
    );
    expect(result.subscriptions[0].provider).toBe("fangzhou");
    expect(result.subscriptions[0].planId).toBe("codingplan");
  });

  it("rewrites fangzhou-agentplan → fangzhou + planId", async () => {
    const data: SubscriptionData = {
      subscriptions: [
        {
          ...makeSubscription({ id: "sub-2", provider: "fangzhou-agentplan" }),
        },
      ],
      categories: [],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(data)
    );

    const migrations = await getMigrations();
    migrations.migrateProviderPlans();

    const result = JSON.parse(
      fs.readFileSync(path.join(tempDataDir, "subscriptions.json"), "utf-8")
    );
    expect(result.subscriptions[0].provider).toBe("fangzhou");
    expect(result.subscriptions[0].planId).toBe("agentplan");
  });

  it("backfills planId for recurring moonshot subscriptions", async () => {
    const data: SubscriptionData = {
      subscriptions: [
        {
          ...makeSubscription({
            id: "sub-3",
            provider: "moonshot",
            subscriptionType: "recurring",
          }),
        },
      ],
      categories: [],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(data)
    );

    const migrations = await getMigrations();
    migrations.migrateProviderPlans();

    const result = JSON.parse(
      fs.readFileSync(path.join(tempDataDir, "subscriptions.json"), "utf-8")
    );
    expect(result.subscriptions[0].planId).toBe("kimi-code");
  });

  it("does NOT backfill planId for one-time moonshot subscriptions", async () => {
    const data: SubscriptionData = {
      subscriptions: [
        {
          ...makeSubscription({
            id: "sub-4",
            provider: "moonshot",
            subscriptionType: "one-time",
          }),
        },
      ],
      categories: [],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(data)
    );

    const migrations = await getMigrations();
    migrations.migrateProviderPlans();

    const result = JSON.parse(
      fs.readFileSync(path.join(tempDataDir, "subscriptions.json"), "utf-8")
    );
    expect(result.subscriptions[0].planId).toBeUndefined();
  });

  it("is idempotent — running twice produces no further changes", async () => {
    const data: SubscriptionData = {
      subscriptions: [
        {
          ...makeSubscription({
            id: "sub-5",
            provider: "fangzhou-codingplan",
            subscriptionType: "recurring",
          }),
        },
        {
          ...makeSubscription({
            id: "sub-6",
            provider: "moonshot",
            subscriptionType: "recurring",
          }),
        },
      ],
      categories: [],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(data)
    );

    const migrations = await getMigrations();
    migrations.migrateProviderPlans();

    const afterFirst = fs.readFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      "utf-8"
    );

    migrations.migrateProviderPlans();

    const afterSecond = fs.readFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      "utf-8"
    );

    expect(afterSecond).toBe(afterFirst);

    const result = JSON.parse(afterSecond);
    expect(result.subscriptions[0].provider).toBe("fangzhou");
    expect(result.subscriptions[0].planId).toBe("codingplan");
    expect(result.subscriptions[1].planId).toBe("kimi-code");
  });

  it("does nothing when file does not exist", async () => {
    const migrations = await getMigrations();
    // Should not throw
    expect(() => migrations.migrateProviderPlans()).not.toThrow();
  });

  it("backfills planId for alibaba recurring subscriptions by name", async () => {
    const data: SubscriptionData = {
      subscriptions: [
        {
          ...makeSubscription({
            id: "sub-alibaba-1",
            provider: "alibaba",
            subscriptionType: "recurring",
            name: "阿里云 Coding Plan",
          }),
        },
        {
          ...makeSubscription({
            id: "sub-alibaba-2",
            provider: "alibaba",
            subscriptionType: "recurring",
            name: "阿里云 Token Plan",
          }),
        },
        {
          ...makeSubscription({
            id: "sub-alibaba-3",
            provider: "alibaba",
            subscriptionType: "recurring",
            name: "其他方案",
          }),
        },
      ],
      categories: [],
    };
    fs.writeFileSync(
      path.join(tempDataDir, "subscriptions.json"),
      JSON.stringify(data)
    );

    const migrations = await getMigrations();
    migrations.migrateProviderPlans();

    const result = JSON.parse(
      fs.readFileSync(path.join(tempDataDir, "subscriptions.json"), "utf-8")
    );
    expect(result.subscriptions[0].planId).toBe("coding-plan");
    expect(result.subscriptions[1].planId).toBe("token-plan");
    // No match → planId remains undefined
    expect(result.subscriptions[2].planId).toBeUndefined();
  });
});

// ============ Handler lookup ============

describe("resolveUsageHandlerKey", () => {
  it("returns providerId:planId for plan-based subscriptions", () => {
    expect(
      resolveUsageHandlerKey(
        makeSubscription({ provider: "fangzhou", planId: "codingplan" })
      )
    ).toBe("fangzhou:codingplan");
    expect(
      resolveUsageHandlerKey(
        makeSubscription({ provider: "fangzhou", planId: "agentplan" })
      )
    ).toBe("fangzhou:agentplan");
    expect(
      resolveUsageHandlerKey(
        makeSubscription({ provider: "moonshot", planId: "kimi-code" })
      )
    ).toBe("moonshot:kimi-code");
  });

  it("returns bare provider id when no planId", () => {
    expect(
      resolveUsageHandlerKey(makeSubscription({ provider: "openai" }))
    ).toBe("openai");
    expect(
      resolveUsageHandlerKey(
        makeSubscription({ provider: "fangzhou", planId: undefined })
      )
    ).toBe("fangzhou");
  });
});

describe("resolveUsageApiUrl", () => {
  it("returns plan-level URL when planId is set", () => {
    const provider: Provider = {
      id: "fangzhou",
      name: "火山方舟",
      plans: [
        {
          id: "codingplan",
          name: "Coding Plan",
          usageApiUrl: "https://example.com/coding",
        },
        {
          id: "agentplan",
          name: "Agent Plan",
          usageApiUrl: "https://example.com/agent",
        },
      ],
    };
    expect(resolveUsageApiUrl(provider, "codingplan")).toBe(
      "https://example.com/coding"
    );
    expect(resolveUsageApiUrl(provider, "agentplan")).toBe(
      "https://example.com/agent"
    );
  });

  it("falls back to provider-level URL when no planId", () => {
    const provider: Provider = {
      id: "test",
      name: "Test",
      usageApiUrl: "https://example.com/usage",
    };
    expect(resolveUsageApiUrl(provider)).toBe("https://example.com/usage");
    expect(resolveUsageApiUrl(provider, undefined)).toBe(
      "https://example.com/usage"
    );
  });

  it("returns undefined when no URL is available", () => {
    const provider: Provider = { id: "test", name: "Test" };
    expect(resolveUsageApiUrl(provider)).toBeUndefined();
    expect(resolveUsageApiUrl(provider, "nonexistent")).toBeUndefined();
  });
});

describe("usageHandlers registration", () => {
  it("has handlers registered under providerId:planId keys", () => {
    expect(usageHandlers["fangzhou:codingplan"]).toBeDefined();
    expect(usageHandlers["fangzhou:agentplan"]).toBeDefined();
    expect(usageHandlers["moonshot:kimi-code"]).toBeDefined();
  });

  it("no longer has old bare-key registrations", () => {
    expect(usageHandlers["fangzhou-codingplan"]).toBeUndefined();
    expect(usageHandlers["fangzhou-agentplan"]).toBeUndefined();
    // moonshot bare key was moved to moonshot:kimi-code
    expect(usageHandlers["moonshot"]).toBeUndefined();
  });
});
