import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Subscription,
  NotificationChannel,
  BalanceTransitionState,
} from "@/lib/types";
import type { PreparedSend } from "@/lib/notifications/payload";
import type { Sender } from "@/lib/notifications/dispatcher";

// Mock storage module so we can control transition state without touching disk.
const storageState: {
  defaultThreshold: number;
  transitions: Record<string, BalanceTransitionState>;
  channels: NotificationChannel[];
  sendResultLog: Array<{ channelId: string; success: boolean; error?: string }>;
} = {
  defaultThreshold: 10,
  transitions: {},
  channels: [],
  sendResultLog: [],
};

vi.mock("@/lib/notifications/storage", () => ({
  readNotificationData: () => ({
    channels: storageState.channels,
    defaultLowBalanceThreshold: storageState.defaultThreshold,
    balanceTransitionStates: storageState.transitions,
  }),
  writeNotificationData: () => {},
  getBalanceTransitionState: (id: string) =>
    storageState.transitions[id] ?? null,
  setBalanceTransitionState: (id: string, state: BalanceTransitionState) => {
    storageState.transitions[id] = state;
  },
  listChannels: () => storageState.channels,
  updateChannelSendResult: (
    id: string,
    result: { success: boolean; timestamp: string; error?: string }
  ) => {
    storageState.sendResultLog.push({
      channelId: id,
      success: result.success,
      error: result.error,
    });
  },
}));

import {
  evaluateLowBalanceTransition,
  resolveThreshold,
  detectLowBalanceEvents,
  dispatchEvent,
  runNotificationTick,
} from "@/lib/notifications/dispatcher";

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Claude Pro",
    category: "AI助手",
    provider: "anthropic",
    subscriptionType: "one-time",
    price: 20,
    status: "active",
    balance: 5,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeChannel(
  overrides: Partial<NotificationChannel> = {}
): NotificationChannel {
  return {
    id: "ch-1",
    type: "dingtalk",
    name: "Test",
    url: "https://example.com/hook",
    enabled: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function resetState() {
  storageState.defaultThreshold = 10;
  storageState.transitions = {};
  storageState.channels = [];
  storageState.sendResultLog = [];
}

describe("resolveThreshold", () => {
  it("uses subscription-level threshold when set", () => {
    const sub = makeSub({ lowBalanceThreshold: 50 });
    expect(resolveThreshold(sub, 10)).toBe(50);
  });

  it("falls back to global default when unset", () => {
    const sub = makeSub();
    expect(resolveThreshold(sub, 10)).toBe(10);
  });
});

describe("evaluateLowBalanceTransition", () => {
  beforeEach(() => {
    resetState();
  });

  it("fires on first observation when balance already below threshold", () => {
    const result = evaluateLowBalanceTransition("sub-1", 5, 10);
    expect(result.shouldFire).toBe(true);
    expect(result.newStatus).toBe("below");
  });

  it("does NOT fire on first observation when balance above threshold", () => {
    const result = evaluateLowBalanceTransition("sub-1", 15, 10);
    expect(result.shouldFire).toBe(false);
    expect(result.newStatus).toBe("above");
  });

  it("does NOT fire when already below and still below", () => {
    storageState.transitions["sub-1"] = {
      status: "below",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const result = evaluateLowBalanceTransition("sub-1", 3, 10);
    expect(result.shouldFire).toBe(false);
    expect(result.newStatus).toBe("below");
  });

  it("FIRES when transition from above to below", () => {
    storageState.transitions["sub-1"] = {
      status: "above",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const result = evaluateLowBalanceTransition("sub-1", 5, 10);
    expect(result.shouldFire).toBe(true);
    expect(result.newStatus).toBe("below");
  });

  it("does NOT fire when still above", () => {
    storageState.transitions["sub-1"] = {
      status: "above",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const result = evaluateLowBalanceTransition("sub-1", 15, 10);
    expect(result.shouldFire).toBe(false);
    expect(result.newStatus).toBe("above");
  });

  it("re-arms after balance goes back above then below", () => {
    storageState.transitions["sub-1"] = {
      status: "below",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    // Balance recovers
    let result = evaluateLowBalanceTransition("sub-1", 15, 10);
    expect(result.shouldFire).toBe(false);
    expect(result.newStatus).toBe("above");
    storageState.transitions["sub-1"] = {
      status: result.newStatus,
      updatedAt: "2024-01-01T00:00:01Z",
    };
    // Balance drops again -> should re-fire
    result = evaluateLowBalanceTransition("sub-1", 5, 10);
    expect(result.shouldFire).toBe(true);
  });
});

describe("detectLowBalanceEvents", () => {
  beforeEach(() => resetState());

  it("skips recurring subscriptions", () => {
    const subs = [makeSub({ subscriptionType: "recurring", balance: 1 })];
    const events = detectLowBalanceEvents(subs);
    expect(events).toHaveLength(0);
  });

  it("skips cancelled subscriptions", () => {
    const subs = [makeSub({ status: "cancelled", balance: 1 })];
    const events = detectLowBalanceEvents(subs);
    expect(events).toHaveLength(0);
  });

  it("skips subscriptions without balance", () => {
    const subs = [makeSub({ balance: undefined })];
    const events = detectLowBalanceEvents(subs);
    expect(events).toHaveLength(0);
  });

  it("emits low-balance event for one-time sub below default threshold", () => {
    const subs = [makeSub({ balance: 5 })];
    const events = detectLowBalanceEvents(subs);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("low-balance");
    if (events[0].kind === "low-balance") {
      expect(events[0].balance).toBe(5);
      expect(events[0].threshold).toBe(10);
    }
  });

  it("uses per-subscription threshold over global default", () => {
    const subs = [makeSub({ balance: 5, lowBalanceThreshold: 3 })];
    const events = detectLowBalanceEvents(subs);
    expect(events).toHaveLength(0);
  });

  it("fires exactly once per above-to-below transition", () => {
    const subs = [makeSub({ balance: 5 })];
    const first = detectLowBalanceEvents(subs);
    expect(first).toHaveLength(1);
    const second = detectLowBalanceEvents(subs);
    expect(second).toHaveLength(0);
  });

  it("re-fires after balance recovers then drops", () => {
    const subs = [makeSub({ balance: 5 })];
    detectLowBalanceEvents(subs);
    subs[0].balance = 15;
    detectLowBalanceEvents(subs);
    subs[0].balance = 3;
    const third = detectLowBalanceEvents(subs);
    expect(third).toHaveLength(1);
  });
});

describe("dispatchEvent", () => {
  beforeEach(() => resetState());

  it("sends to all enabled channels", async () => {
    const calls: PreparedSend[] = [];
    const fakeSender: Sender = async (s) => {
      calls.push(s);
    };
    const ch1 = makeChannel({ id: "ch-1", type: "dingtalk" });
    const ch2 = makeChannel({ id: "ch-2", type: "webhook" });
    const event = {
      kind: "low-balance" as const,
      subscription: makeSub(),
      balance: 5,
      threshold: 10,
      triggeredAt: "2024-06-01T00:00:00Z",
    };
    await dispatchEvent(event, [ch1, ch2], fakeSender);
    expect(calls).toHaveLength(2);
    expect(storageState.sendResultLog).toHaveLength(2);
    expect(storageState.sendResultLog.every((r) => r.success)).toBe(true);
  });

  it("skips disabled channels", async () => {
    const calls: PreparedSend[] = [];
    const fakeSender: Sender = async (s) => calls.push(s);
    const ch = makeChannel({ enabled: false });
    const event = {
      kind: "low-balance" as const,
      subscription: makeSub(),
      balance: 5,
      threshold: 10,
      triggeredAt: "2024-06-01T00:00:00Z",
    };
    await dispatchEvent(event, [ch], fakeSender);
    expect(calls).toHaveLength(0);
  });

  it("single channel failure does not abort other channels", async () => {
    const calls: PreparedSend[] = [];
    const fakeSender: Sender = async (s) => {
      if (s.channel.id === "ch-1") throw new Error("boom");
      calls.push(s);
    };
    const ch1 = makeChannel({ id: "ch-1" });
    const ch2 = makeChannel({ id: "ch-2" });
    const event = {
      kind: "low-balance" as const,
      subscription: makeSub(),
      balance: 5,
      threshold: 10,
      triggeredAt: "2024-06-01T00:00:00Z",
    };
    await dispatchEvent(event, [ch1, ch2], fakeSender);
    expect(calls).toHaveLength(1);
    expect(calls[0].channel.id).toBe("ch-2");
    const ch1Result = storageState.sendResultLog.find(
      (r) => r.channelId === "ch-1"
    );
    expect(ch1Result?.success).toBe(false);
    expect(ch1Result?.error).toContain("boom");
  });
});

describe("runNotificationTick", () => {
  beforeEach(() => resetState());

  it("no-ops when no channels configured", async () => {
    const calls: PreparedSend[] = [];
    const fakeSender: Sender = async (s) => calls.push(s);
    await runNotificationTick([makeSub()], fakeSender);
    expect(calls).toHaveLength(0);
  });

  it("dispatches low-balance event to configured channel", async () => {
    storageState.channels = [makeChannel({ id: "ch-1", type: "webhook" })];
    const calls: PreparedSend[] = [];
    const fakeSender: Sender = async (s) => calls.push(s);
    await runNotificationTick([makeSub({ balance: 5 })], fakeSender);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].body as string);
    expect(body.event).toBe("low-balance");
    expect(body.lowBalance.balance).toBe(5);
  });
});
