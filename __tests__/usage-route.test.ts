import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/subscriptions/[id]/usage/route";
import { getSubscriptionById } from "@/lib/db";
import { resolveUsageHandler } from "@/lib/providers";
import { calibrateSubscriptionFromUsage } from "@/lib/reset-alignment";
import type { Subscription, UsageResult } from "@/lib/types";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  getSubscriptionById: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  decryptCredentials: vi.fn(() => ({ apiKey: "decrypted-key" })),
}));

vi.mock("@/lib/providers", () => ({
  resolveUsageHandler: vi.fn(),
}));

vi.mock("@/lib/reset-alignment", () => ({
  calibrateSubscriptionFromUsage: vi.fn(),
}));

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
    credentials: "v1:encrypted-blob",
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
    monthly: {
      limit: "100",
      used: "10",
      remaining: "90",
      resetTime: "2099-07-15T12:00:00Z",
    },
    boosterWallet: null,
    parallel: null,
    membership: null,
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new Request(
    "http://localhost/api/subscriptions/sub-1/usage"
  ) as unknown as NextRequest;
}

describe("GET /api/subscriptions/[id]/usage calibration write-back", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function arrangeSuccess(usageResult: UsageResult) {
    vi.mocked(getSubscriptionById).mockReturnValue(makeSubscription());
    vi.mocked(resolveUsageHandler).mockReturnValue({
      ok: true,
      handler: {
        fetchUsage: vi.fn().mockResolvedValue(usageResult),
        testConnection: vi.fn(),
      },
      usageApiUrl: "https://example.com/usage",
    } as never);
  }

  it("calibrates from the query result and returns the stripped subscription", async () => {
    const usageResult = makeUsageResult();
    arrangeSuccess(usageResult);
    const calibrated = makeSubscription({
      resetSchedules: [
        {
          id: "sched-monthly",
          enabled: true,
          type: "monthly",
          timezone: "UTC",
          dayOfMonth: 15,
          timeOfDay: "12:00",
          nextResetTime: "2099-07-15T12:00:00Z",
          exhausted: false,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-06-01T01:00:00Z",
        },
      ],
    });
    vi.mocked(calibrateSubscriptionFromUsage).mockReturnValue(calibrated);

    const res = await GET(makeRequest(), { params: { id: "sub-1" } });

    expect(res.status).toBe(200);
    expect(calibrateSubscriptionFromUsage).toHaveBeenCalledWith(
      "sub-1",
      usageResult
    );
    const body = await res.json();
    // Usage fields pass through untouched.
    expect(body.monthly.used).toBe("10");
    // The calibrated subscription rides along, credentials stripped.
    expect(body.subscription.resetSchedules[0].dayOfMonth).toBe(15);
    expect(body.subscription.credentials).toBeUndefined();
    expect(body.subscription.hasCredentials).toBe(true);
  });

  it("falls back to the pre-query subscription when calibration finds it deleted", async () => {
    arrangeSuccess(makeUsageResult());
    vi.mocked(calibrateSubscriptionFromUsage).mockReturnValue(null);

    const res = await GET(makeRequest(), { params: { id: "sub-1" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.id).toBe("sub-1");
    expect(body.subscription.credentials).toBeUndefined();
    expect(body.subscription.hasCredentials).toBe(true);
  });
});
