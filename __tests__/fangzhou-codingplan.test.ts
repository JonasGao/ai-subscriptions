import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchCodingPlanUsage,
  testCodingPlanConnection,
} from "@/lib/providers/fangzhou-codingplan";

// ── helpers ─────────────────────────────────────────────────────────────────

function mockResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const baseCreds = { ak: "test-ak", sk: "test-sk" };

// Real captured response shape from production (2026-09-20)
const REAL_FIXTURE = {
  ResponseMetadata: {
    RequestId: "abc-123",
    Action: "GetCodingPlanUsage",
    Service: "ark",
    Region: "cn-beijing",
  },
  Result: {
    Status: "Running",
    UpdateTimestamp: 1789872783,
    QuotaUsage: [
      {
        Level: "session",
        Percent: 0.000029,
        ResetTimestamp: 1789889755,
        Cap: 100,
        RewardTotalPercent: 0,
      },
      {
        Level: "weekly",
        Percent: 0.0000039,
        ResetTimestamp: 1789920000,
        Cap: 100,
        RewardTotalPercent: 0,
      },
      {
        Level: "monthly",
        Percent: 0.0000019,
        ResetTimestamp: 1792511999,
        Cap: 100,
        RewardTotalPercent: 0,
      },
    ],
    HasReward: false,
  },
};

const SESSION_RESET_ISO = new Date(1789889755 * 1000).toISOString();
const WEEKLY_RESET_ISO = new Date(1789920000 * 1000).toISOString();
const MONTHLY_RESET_ISO = new Date(1792511999 * 1000).toISOString();

// ── fetchCodingPlanUsage ────────────────────────────────────────────────────

describe("fetchCodingPlanUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: real fixture three-window mapping
  it("maps real fixture to three windows with Cap→limit, Percent→used, remaining computed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(REAL_FIXTURE));

    const result = await fetchCodingPlanUsage(baseCreds);

    expect(result.provider).toBe("fangzhou");
    expect(result.boosterWallet).toBeNull();
    expect(result.parallel).toBeNull();
    expect(result.membership).toBeNull();

    // session → fiveHour
    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("0.000029");
    expect(result.fiveHour!.limit).toBe("100");
    expect(result.fiveHour!.remaining).toBe("99.999971");
    expect(result.fiveHour!.resetTime).toBe(SESSION_RESET_ISO);

    // weekly → weekly
    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.used).toBe("0.0000039");
    expect(result.weekly!.limit).toBe("100");
    expect(result.weekly!.remaining).toBe("99.9999961");
    expect(result.weekly!.resetTime).toBe(WEEKLY_RESET_ISO);

    // monthly → monthly
    expect(result.monthly).not.toBeNull();
    expect(result.monthly!.used).toBe("0.0000019");
    expect(result.monthly!.limit).toBe("100");
    expect(result.monthly!.remaining).toBe("99.9999981");
    expect(result.monthly!.resetTime).toBe(MONTHLY_RESET_ISO);

    // No warnings for well-known levels
    expect(result.warnings).toBeUndefined();
  });

  // Test 2: unknown Level row → skipped + warnings populated + console.warn
  it("skips unknown Level rows, emits warning, and still maps known rows", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          Status: "Running",
          QuotaUsage: [
            {
              Level: "unknown-tier",
              Percent: 50,
              ResetTimestamp: 1789889755,
              Cap: 100,
            },
            {
              Level: "session",
              Percent: 30,
              ResetTimestamp: 1789889755,
              Cap: 100,
            },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);

    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("30");
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
    expect(result.warnings).toEqual(["未识别的配额窗口: unknown-tier"]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown-tier")
    );
  });

  // Test 3: ResetTimestamp=0 → resetTime null
  it("maps ResetTimestamp=0 to resetTime null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          QuotaUsage: [
            {
              Level: "session",
              Percent: 10,
              ResetTimestamp: 0,
              Cap: 100,
            },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);
    expect(result.fiveHour!.resetTime).toBeNull();
  });

  // Test 4: Cap missing → limit falls back to "100"
  it("falls back to limit=100 when Cap is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          QuotaUsage: [
            {
              Level: "weekly",
              Percent: 42,
              ResetTimestamp: 1789920000,
              // Cap omitted
            },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);
    expect(result.weekly!.limit).toBe("100");
    expect(result.weekly!.used).toBe("42");
    expect(result.weekly!.remaining).toBe("58");
  });

  // Test 5: empty QuotaUsage array → throw
  it("throws 'Account not subscribed to CodingPlan' when QuotaUsage is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: { QuotaUsage: [] },
      })
    );

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "Account not subscribed to CodingPlan"
    );
  });

  // Test 6: QuotaUsage not an array → throw
  it("throws when QuotaUsage is not an array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: { QuotaUsage: "not-an-array" },
      })
    );

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "Account not subscribed to CodingPlan"
    );
  });

  // Test 7: Result missing → throw
  it("throws when Result is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}));

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "Account not subscribed to CodingPlan"
    );
  });

  // Test 8: HTTP 400 → throw
  it("throws 'CodingPlan usage API returned 400' on HTTP 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ error: "bad request" }, 400)
    );

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "CodingPlan usage API returned 400"
    );
  });

  // Test 9: HTTP 500 → throw
  it("throws 'CodingPlan usage API returned 500' on HTTP 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "CodingPlan usage API returned 500"
    );
  });

  // Test 10: network error (AbortError)
  it("propagates AbortError on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError")
    );

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "The operation was aborted"
    );
  });

  // Test 11: network error (TypeError)
  it("propagates TypeError on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    await expect(fetchCodingPlanUsage(baseCreds)).rejects.toThrow(
      "Failed to fetch"
    );
  });

  // Test 12: AK/SK missing
  it("throws when AK/SK is missing", async () => {
    await expect(fetchCodingPlanUsage({})).rejects.toThrow(
      "AK/SK not configured"
    );
    await expect(fetchCodingPlanUsage({ ak: "", sk: "" })).rejects.toThrow(
      "AK/SK not configured"
    );
  });

  // Test 13: Cap with non-default value used correctly
  it("uses Cap value for limit when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          QuotaUsage: [
            {
              Level: "session",
              Percent: 25,
              ResetTimestamp: 1789889755,
              Cap: 200,
            },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);
    expect(result.fiveHour!.limit).toBe("200");
    expect(result.fiveHour!.used).toBe("25");
    expect(result.fiveHour!.remaining).toBe("175");
  });

  // Test 14: all three rows unknown → all windows null, warnings populated
  it("returns all null windows with warnings when all Level values are unknown", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          QuotaUsage: [
            { Level: "alpha", Percent: 10, ResetTimestamp: 100, Cap: 100 },
            { Level: "beta", Percent: 20, ResetTimestamp: 200, Cap: 100 },
            { Level: "gamma", Percent: 30, ResetTimestamp: 300, Cap: 100 },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);
    expect(result.fiveHour).toBeNull();
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
    expect(result.warnings).toEqual([
      "未识别的配额窗口: alpha",
      "未识别的配额窗口: beta",
      "未识别的配额窗口: gamma",
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  // Test 15: Status field is ignored (not checked)
  it("ignores Result.Status field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          Status: "Stopped",
          QuotaUsage: [
            {
              Level: "session",
              Percent: 50,
              ResetTimestamp: 1789889755,
              Cap: 100,
            },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);
    expect(result.fiveHour!.used).toBe("50");
  });

  // Test 16: HasReward/RewardTotalPercent/UpdateTimestamp ignored
  it("ignores HasReward, RewardTotalPercent, UpdateTimestamp", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          Status: "Running",
          UpdateTimestamp: 9999999999,
          HasReward: true,
          QuotaUsage: [
            {
              Level: "weekly",
              Percent: 15,
              ResetTimestamp: 1789920000,
              Cap: 100,
              RewardTotalPercent: 50,
            },
          ],
        },
      })
    );

    const result = await fetchCodingPlanUsage(baseCreds);
    expect(result.weekly!.used).toBe("15");
    expect(result.weekly!.limit).toBe("100");
  });
});

// ── testCodingPlanConnection ────────────────────────────────────────────────

describe("testCodingPlanConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns failure when AK/SK is missing", async () => {
    const result = await testCodingPlanConnection({});
    expect(result).toEqual({ ok: false, message: "AK/SK 未配置" });
  });

  it("returns failure when AK/SK is empty string", async () => {
    const result = await testCodingPlanConnection({ ak: "", sk: "" });
    expect(result).toEqual({ ok: false, message: "AK/SK 未配置" });
  });

  it("returns success with subscription info when InfoList is non-empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          InfoList: [{ BizInfo: "CodingPlan Pro", Status: "Running" }],
        },
      })
    );

    const result = await testCodingPlanConnection(baseCreds);
    expect(result).toEqual({
      ok: true,
      message: "已订阅 (CodingPlan Pro, Running)",
    });
  });

  it("returns success with fallback labels when BizInfo/Status missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: {
          InfoList: [{}],
        },
      })
    );

    const result = await testCodingPlanConnection(baseCreds);
    expect(result).toEqual({ ok: true, message: "已订阅 (unknown, unknown)" });
  });

  it("returns failure when InfoList is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        Result: { InfoList: [] },
      })
    );

    const result = await testCodingPlanConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "未检测到 CodingPlan 订阅" });
  });

  it("returns failure on HTTP non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    const result = await testCodingPlanConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "API 返回 500" });
  });

  it("returns failure on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNRESET: network down")
    );

    const result = await testCodingPlanConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "ECONNRESET: network down",
    });
  });

  it("stringifies non-Error exceptions", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("weird string error");

    const result = await testCodingPlanConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "weird string error",
    });
  });
});
