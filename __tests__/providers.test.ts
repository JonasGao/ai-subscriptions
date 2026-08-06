import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAgentPlanUsage } from "@/lib/providers/fangzhou-agentplan";
import { fetchCodingPlanUsage } from "@/lib/providers/fangzhou-codingplan";

describe("fangzhou-agentplan", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps AgentPlan Periods to UsageResult", async () => {
    const mockResponse = {
      Result: {
        Periods: [
          {
            Label: "5h",
            Used: 250,
            Total: 1000,
            Percent: 25,
            ResetTimestamp: 1717049200000,
          },
          {
            Label: "weekly",
            Used: 12500,
            Total: 50000,
            Percent: 25,
            ResetTimestamp: 1717625200000,
          },
          {
            Label: "monthly",
            Used: 50000,
            Total: 200000,
            Percent: 25,
            ResetTimestamp: 1719615600000,
          },
        ],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await fetchAgentPlanUsage({ ak: "test-ak", sk: "test-sk" });

    expect(result.provider).toBe("fangzhou-agentplan");

    // weekly → usage
    expect(result.usage).not.toBeNull();
    expect(result.usage!.used).toBe("12500");
    expect(result.usage!.limit).toBe("50000");
    expect(result.usage!.remaining).toBe("37500");
    expect(result.usage!.resetTime).toBe("1717625200000");

    // 5h → limits[0], monthly → limits[1]
    expect(result.limits).toHaveLength(2);
    expect(result.limits[0].window.duration).toBe(5);
    expect(result.limits[0].window.timeUnit).toBe("TIME_UNIT_HOUR");
    expect(result.limits[0].detail.used).toBe("250");
    expect(result.limits[0].detail.limit).toBe("1000");

    expect(result.limits[1].window.duration).toBe(30);
    expect(result.limits[1].window.timeUnit).toBe("TIME_UNIT_DAY");
    expect(result.limits[1].detail.used).toBe("50000");

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

    expect(result.provider).toBe("fangzhou-codingplan");

    // weekly → usage (percent → used, limit=100)
    expect(result.usage).not.toBeNull();
    expect(result.usage!.used).toBe("45");
    expect(result.usage!.limit).toBe("100");
    expect(result.usage!.remaining).toBe("55");
    // ResetTimestamp is in seconds → converted to ms
    expect(result.usage!.resetTime).toBe("1717625200000");

    // session → limits[0] (24h), monthly → limits[1] (30d)
    expect(result.limits).toHaveLength(2);
    expect(result.limits[0].window.duration).toBe(24);
    expect(result.limits[0].window.timeUnit).toBe("TIME_UNIT_HOUR");
    expect(result.limits[0].detail.used).toBe("30");
    expect(result.limits[0].detail.limit).toBe("100");
    expect(result.limits[0].detail.remaining).toBe("70");
    // session ResetTimestamp also converted from seconds to ms
    expect(result.limits[0].detail.resetTime).toBe("1717049200000");

    expect(result.limits[1].window.duration).toBe(30);
    expect(result.limits[1].window.timeUnit).toBe("TIME_UNIT_DAY");
    expect(result.limits[1].detail.used).toBe("60");
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
