import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type {
  Subscription,
  SubscriptionData,
  ResetTickTrigger,
  UsageResult,
  Provider,
  ResetSchedule,
  ResetScheduleType,
} from "@/lib/types";

// ── temp data dir so we never touch real disk ────────────────────────────────
let tempDataDir: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "align-test-"));
  process.env.DATA_DIR = tempDataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  vi.restoreAllMocks();
});

async function getDb() {
  return await import("@/lib/db");
}

async function getAlignment() {
  return await import("@/lib/reset-alignment");
}

// ── fake handler machinery ───────────────────────────────────────────────────
const handlerState: {
  fetchUsage: ReturnType<typeof vi.fn>;
} = {
  fetchUsage: vi.fn<() => Promise<UsageResult>>(),
};

const fakeProvider: Provider = {
  id: "test-provider",
  name: "Test Provider",
  usageApiUrl: "https://example.com/usage",
};

// Mock db module to inject fake getProviders.
vi.mock("@/lib/db", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("@/lib/db");
  return {
    ...original,
    getProviders: () => [fakeProvider],
  };
});

// Mock the providers module so we can inject a fake handler + URL resolver.
vi.mock("@/lib/providers", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("@/lib/providers");
  return {
    ...original,
    usageHandlers: {
      "test-provider:test-plan": {
        fetchUsage: handlerState.fetchUsage,
        testConnection: vi.fn(),
      },
    },
    resolveUsageHandlerKey: (sub: Subscription) =>
      sub.planId ? `${sub.provider}:${sub.planId}` : sub.provider,
    resolveUsageApiUrl: () => "https://example.com/usage",
    resolveUsageHandler: (sub: Subscription) => {
      if (sub.subscriptionType !== "recurring") {
        return { ok: false as const, reason: "not-recurring" as const };
      }
      const handlerKey = sub.planId
        ? `${sub.provider}:${sub.planId}`
        : sub.provider;
      const handler = {
        "test-provider:test-plan": {
          fetchUsage: handlerState.fetchUsage,
          testConnection: vi.fn(),
        },
      }[handlerKey];
      if (!handler) {
        return { ok: false as const, reason: "no-handler" as const };
      }
      return {
        ok: true as const,
        handler,
        usageApiUrl: "https://example.com/usage",
      };
    },
  };
});

// Mock encryption so we never touch the real key.
vi.mock("@/lib/encryption", () => ({
  decryptCredentials: (encrypted: string) => {
    if (encrypted === "BAD_CREDS") throw new Error("decrypt failed");
    return JSON.parse(encrypted);
  },
  encryptCredentials: (obj: Record<string, string>) => JSON.stringify(obj),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeSchedule(
  overrides: Partial<ResetSchedule> & { type?: ResetScheduleType } = {}
): ResetSchedule {
  const type = overrides.type ?? "monthly";
  return {
    id: overrides.id ?? `sched-${type}`,
    enabled: overrides.enabled ?? true,
    type,
    nextResetTime: overrides.nextResetTime ?? "2024-01-01T00:00:00Z",
    exhausted: overrides.exhausted ?? false,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeData(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    subscriptions: [],
    categories: [],
    tags: [],
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Test Sub",
    category: "AI助手",
    provider: "test-provider",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 20,
    status: "active",
    credentials: JSON.stringify({ apiKey: "key" }),
    planId: "test-plan",
    resetSchedules: [makeSchedule()],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeUsageResult(overrides: Partial<UsageResult> = {}): UsageResult {
  return {
    provider: "test-provider",
    fiveHour: null,
    weekly: null,
    monthly: null,
    boosterWallet: null,
    parallel: null,
    membership: null,
    ...overrides,
  };
}

const FUTURE_ISO = "2099-12-31T23:59:59Z";

function makeTrigger(
  subId: string,
  scheduleType: "fiveHour" | "weekly" | "monthly" = "monthly",
  nextResetTime = FUTURE_ISO
): ResetTickTrigger {
  return { subscriptionId: subId, scheduleType, nextResetTime };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("alignResetTimes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T01:00:00Z"));
    handlerState.fetchUsage.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op when triggers are empty", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));
    await alignResetTimes([]);
    expect(handlerState.fetchUsage).not.toHaveBeenCalled();
  });

  it("overwrites nextResetTime with a valid future resetTime from the API", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    const newReset = "2024-07-15T12:00:00Z";
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: newReset,
        },
      })
    );
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(newReset);
  });

  it("aligns all enabled schedules on the same sub with ONE fetchUsage call", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    const weeklyReset = "2024-06-10T00:00:00Z";
    const monthlyReset = "2024-07-01T00:00:00Z";
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        weekly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: weeklyReset,
        },
        monthly: {
          limit: "500",
          used: "0",
          remaining: "500",
          resetTime: monthlyReset,
        },
      })
    );
    db.writeData(
      makeData({
        subscriptions: [
          makeSubscription({
            resetSchedules: [
              makeSchedule({ id: "sched-weekly", type: "weekly" }),
              makeSchedule(),
            ],
          }),
        ],
      })
    );

    await alignResetTimes([
      makeTrigger("sub-1", "weekly"),
      makeTrigger("sub-1", "monthly"),
    ]);

    expect(handlerState.fetchUsage).toHaveBeenCalledTimes(1);
    const saved = db.getSubscriptions();
    const byType = new Map(
      saved[0].resetSchedules!.map((s) => [s.type, s.nextResetTime])
    );
    expect(byType.get("weekly")).toBe(weeklyReset);
    expect(byType.get("monthly")).toBe(monthlyReset);
  });

  it("does NOT update when bucket resetTime is null", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: { limit: "100", used: "0", remaining: "100", resetTime: null },
      })
    );
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("does NOT update when bucket is missing entirely", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockResolvedValue(makeUsageResult());
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("does NOT update when fetchUsage throws", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockRejectedValue(new Error("network down"));
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("does NOT update when resetTime is in the past", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: "2020-01-01T00:00:00Z",
        },
      })
    );
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("does NOT update when resetTime equals now", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: "2024-06-01T01:00:00Z",
        },
      })
    );
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("does NOT update when resetTime is an invalid string", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: "not-a-date",
        },
      })
    );
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("skips when subscription has no credentials", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    db.writeData(
      makeData({
        subscriptions: [makeSubscription({ credentials: undefined })],
      })
    );

    await alignResetTimes([makeTrigger("sub-1")]);

    expect(handlerState.fetchUsage).not.toHaveBeenCalled();
  });

  it("skips when handler cannot be resolved", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    // Unknown provider — handler won't match.
    db.writeData(
      makeData({
        subscriptions: [
          makeSubscription({
            provider: "unknown-provider",
            planId: "unknown-plan",
          }),
        ],
      })
    );

    await alignResetTimes([makeTrigger("sub-1")]);

    expect(handlerState.fetchUsage).not.toHaveBeenCalled();
  });

  it("skips when subscription is not recurring", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    db.writeData(
      makeData({
        subscriptions: [
          makeSubscription({
            subscriptionType: "one-time",
            billingCycle: undefined,
          }),
        ],
      })
    );

    await alignResetTimes([makeTrigger("sub-1")]);

    expect(handlerState.fetchUsage).not.toHaveBeenCalled();
  });

  it("skips when credentials fail to decrypt (falls into fetch failed)", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    db.writeData(
      makeData({
        subscriptions: [makeSubscription({ credentials: "BAD_CREDS" })],
      })
    );

    await alignResetTimes([makeTrigger("sub-1")]);

    expect(handlerState.fetchUsage).not.toHaveBeenCalled();
    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("aligns a paused subscription", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    const newReset = "2024-07-15T12:00:00Z";
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: newReset,
        },
      })
    );
    db.writeData(
      makeData({
        subscriptions: [makeSubscription({ status: "paused" })],
      })
    );

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(newReset);
  });

  it("dedupes: same sub multiple triggers → only ONE fetchUsage call", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: FUTURE_ISO,
        },
      })
    );
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([
      makeTrigger("sub-1"),
      makeTrigger("sub-1"),
      makeTrigger("sub-1"),
    ]);

    expect(handlerState.fetchUsage).toHaveBeenCalledTimes(1);
  });

  it("does NOT write when API resetTime equals current nextResetTime", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    const currentNext = "2024-06-15T00:00:00Z";
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: currentNext,
        },
      })
    );
    db.writeData(
      makeData({
        subscriptions: [
          makeSubscription({
            resetSchedules: [makeSchedule({ nextResetTime: currentNext })],
          }),
        ],
      })
    );

    // Spy on writeData to detect whether a fresh write occurred.
    const writeSpy = vi.spyOn(db, "writeData");
    const writesBefore = writeSpy.mock.calls.length;

    await alignResetTimes([makeTrigger("sub-1")]);

    // writeData was NOT called again for this alignment.
    expect(writeSpy.mock.calls.length).toBe(writesBefore);
    writeSpy.mockRestore();
  });

  it("skips when subscription was deleted before the write-back", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockImplementation(async () => {
      // Simulate concurrent deletion: remove the sub while fetchUsage is
      // in flight.
      const data = db.readData();
      data.subscriptions = data.subscriptions.filter((s) => s.id !== "sub-1");
      db.writeData(data);
      return makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: FUTURE_ISO,
        },
      });
    });
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved).toHaveLength(0);
  });

  it("skips when schedule was deleted before the write-back", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockImplementation(async () => {
      const data = db.readData();
      data.subscriptions[0].resetSchedules = [];
      db.writeData(data);
      return makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: FUTURE_ISO,
        },
      });
    });
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    expect(saved[0].resetSchedules).toHaveLength(0);
  });

  it("skips when schedule was disabled before the write-back", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    handlerState.fetchUsage.mockImplementation(async () => {
      const data = db.readData();
      data.subscriptions[0].resetSchedules![0].enabled = false;
      db.writeData(data);
      return makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: FUTURE_ISO,
        },
      });
    });
    db.writeData(makeData({ subscriptions: [makeSubscription()] }));

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    // Schedule remained untouched (not re-enabled, nextResetTime unchanged).
    expect(saved[0].resetSchedules![0].enabled).toBe(false);
    expect(saved[0].resetSchedules![0].nextResetTime).toBe(
      "2024-01-01T00:00:00Z"
    );
  });

  it("bumps subscription.updatedAt and schedule.updatedAt on write-back", async () => {
    const db = await getDb();
    const { alignResetTimes } = await getAlignment();
    const newReset = "2024-07-15T12:00:00Z";
    handlerState.fetchUsage.mockResolvedValue(
      makeUsageResult({
        monthly: {
          limit: "100",
          used: "0",
          remaining: "100",
          resetTime: newReset,
        },
      })
    );
    const originalUpdated = "2024-01-01T00:00:00Z";
    db.writeData(
      makeData({
        subscriptions: [
          makeSubscription({
            updatedAt: originalUpdated,
            resetSchedules: [
              makeSchedule({
                createdAt: originalUpdated,
                updatedAt: originalUpdated,
              }),
            ],
          }),
        ],
      })
    );

    await alignResetTimes([makeTrigger("sub-1")]);

    const saved = db.getSubscriptions();
    const nowIso = new Date("2024-06-01T01:00:00Z").toISOString();
    expect(saved[0].updatedAt).toBe(nowIso);
    expect(saved[0].resetSchedules![0].updatedAt).toBe(nowIso);
  });
});
