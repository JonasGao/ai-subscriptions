import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAgentPlanUsage } from "@/lib/providers/fangzhou-agentplan";
import { fetchCodingPlanUsage } from "@/lib/providers/fangzhou-codingplan";
import { fetchMoonshotUsage } from "@/lib/providers/moonshot";

describe("fangzhou-agentplan", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps AgentPlan flat Result object to UsageResult", async () => {
    const mockResponse = {
      Result: {
        PlanType: "medium",
        AFPFiveHour: {
          Quota: 1000,
          Used: 250,
          SubscribeTime: 1717049200000,
          ResetTime: 1717049200000,
        },
        AFPWeekly: {
          Quota: 50000,
          Used: 12500,
          SubscribeTime: 1717625200000,
          ResetTime: 1717625200000,
        },
        AFPMonthly: {
          Quota: 200000,
          Used: 50000,
          SubscribeTime: 1719615600000,
          ResetTime: 1719615600000,
        },
        AFPDaily: {
          Quota: 50000,
          Used: 1683,
          SubscribeTime: 1717000000000,
          ResetTime: 1717000000000,
        },
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await fetchAgentPlanUsage({ ak: "test-ak", sk: "test-sk" });

    expect(result.provider).toBe("fangzhou");

    // AFPFiveHour → fiveHour
    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("250");
    expect(result.fiveHour!.limit).toBe("1000");
    expect(result.fiveHour!.remaining).toBe("750");
    expect(result.fiveHour!.resetTime).toBe(
      new Date(1717049200000).toISOString()
    );

    // AFPWeekly → weekly
    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.used).toBe("12500");
    expect(result.weekly!.limit).toBe("50000");
    expect(result.weekly!.remaining).toBe("37500");
    expect(result.weekly!.resetTime).toBe(
      new Date(1717625200000).toISOString()
    );

    // AFPMonthly → monthly
    expect(result.monthly).not.toBeNull();
    expect(result.monthly!.used).toBe("50000");
    expect(result.monthly!.limit).toBe("200000");
    expect(result.monthly!.remaining).toBe("150000");
    expect(result.monthly!.resetTime).toBe(
      new Date(1719615600000).toISOString()
    );

    expect(result.boosterWallet).toBeNull();
    expect(result.parallel).toBeNull();
    expect(result.membership).toBeNull();
  });

  it("throws when not subscribed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ Result: null }),
      text: async () => '{"Result":null}',
    } as Response);

    await expect(
      fetchAgentPlanUsage({ ak: "test-ak", sk: "test-sk" })
    ).rejects.toThrow("Account not subscribed");
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as unknown as Response);

    await expect(
      fetchAgentPlanUsage({ ak: "test-ak", sk: "test-sk" })
    ).rejects.toThrow("AgentPlan usage API returned 403");
  });
});

describe("fangzhou-codingplan", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps CodingPlan QuotaUsage (Percent only) to UsageResult", async () => {
    const mockResponse = {
      Result: {
        QuotaUsage: [
          { Label: "session", Percent: 30, ResetTimestamp: 1717049200 },
          { Label: "weekly", Percent: 45, ResetTimestamp: 1717625200 },
          { Label: "monthly", Percent: 60, ResetTimestamp: 1719615600 },
        ],
        UpdateTimestamp: 1717000000000,
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await fetchCodingPlanUsage({ ak: "test-ak", sk: "test-sk" });

    expect(result.provider).toBe("fangzhou");

    // session → fiveHour (percent → used, limit=100)
    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("30");
    expect(result.fiveHour!.limit).toBe("100");
    expect(result.fiveHour!.remaining).toBe("70");
    // session ResetTimestamp is in seconds → converted to ISO string
    expect(result.fiveHour!.resetTime).toBe(
      new Date(1717049200 * 1000).toISOString()
    );

    // weekly → weekly
    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.used).toBe("45");
    expect(result.weekly!.limit).toBe("100");
    expect(result.weekly!.remaining).toBe("55");
    expect(result.weekly!.resetTime).toBe(
      new Date(1717625200 * 1000).toISOString()
    );

    // monthly → monthly
    expect(result.monthly).not.toBeNull();
    expect(result.monthly!.used).toBe("60");
    expect(result.monthly!.limit).toBe("100");
    expect(result.monthly!.remaining).toBe("40");
  });

  it("throws when QuotaUsage is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ Result: { QuotaUsage: [] } }),
      text: async () => '{"Result":{"QuotaUsage":[]}}',
    } as Response);

    await expect(
      fetchCodingPlanUsage({ ak: "test-ak", sk: "test-sk" })
    ).rejects.toThrow("Account not subscribed");
  });
});

describe("moonshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps usage → weekly and the 5h (300min) limit → fiveHour", async () => {
    const mockResponse = {
      usage: {
        limit: "1024",
        used: "100",
        remaining: "924",
        resetTime: "2026-03-04T04:01:38Z",
      },
      limits: [
        {
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
          detail: {
            limit: "200",
            used: "7",
            remaining: "193",
            resetTime: "2026-03-03T11:16:04Z",
          },
        },
      ],
      user: {
        userId: "u1",
        region: "REGION_OVERSEA",
        membership: { level: "LEVEL_BASIC" },
        businessId: "",
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await fetchMoonshotUsage(
      "test-key",
      "https://api.kimi.com/coding/v1/usages"
    );

    expect(result.provider).toBe("moonshot");
    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.used).toBe("100");
    expect(result.weekly!.limit).toBe("1024");
    expect(result.weekly!.remaining).toBe("924");

    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("7");
    expect(result.fiveHour!.limit).toBe("200");
    expect(result.fiveHour!.remaining).toBe("193");

    expect(result.monthly).toBeNull();
    expect(result.membership?.level).toBe("LEVEL_BASIC");
  });

  it("ignores limits that are not 5-hour or monthly windows", async () => {
    const mockResponse = {
      usage: {
        limit: "1024",
        used: "100",
        remaining: "924",
        resetTime: "2026-03-04T04:01:38Z",
      },
      limits: [
        {
          window: { duration: 60, timeUnit: "TIME_UNIT_MINUTE" },
          detail: {
            limit: "200",
            used: "7",
            remaining: "193",
            resetTime: "2026-03-03T11:16:04Z",
          },
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await fetchMoonshotUsage(
      "test-key",
      "https://api.kimi.com/coding/v1/usages"
    );

    expect(result.fiveHour).toBeNull();
    expect(result.monthly).toBeNull();
    expect(result.weekly).not.toBeNull();
  });
});
