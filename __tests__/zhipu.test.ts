import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchZhipuUsage, testZhipuConnection } from "@/lib/providers/zhipu";

// ── helpers ─────────────────────────────────────────────────────────────────

function mockResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const baseCreds = { apiKey: "zhipu_test_key" };

// Real captured sample from design doc §"实测响应样本"
const REAL_FIXTURE = {
  code: 200,
  msg: "Operation successful",
  data: {
    limits: [
      {
        type: "CREDIT_LIMIT",
        unit: 3,
        number: 5,
        usage: 12000,
        currentValue: 0,
        remaining: 12000,
        percentage: 0,
      },
      {
        type: "CREDIT_LIMIT",
        unit: 6,
        number: 1,
        usage: 60000,
        currentValue: 0,
        remaining: 60000,
        percentage: 0,
        nextResetTime: 1790302548999,
      },
    ],
    level: "pro",
  },
  success: true,
};

const WEEKLY_RESET_ISO = new Date(1790302548999).toISOString();

// ── fetchZhipuUsage ─────────────────────────────────────────────────────────

describe("fetchZhipuUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: normal path with real fixture
  it("maps real fixture to fiveHour + weekly + membership(PRO), monthly null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(REAL_FIXTURE));

    const result = await fetchZhipuUsage(baseCreds);

    expect(result.provider).toBe("zhipu");
    expect(result.boosterWallet).toBeNull();
    expect(result.parallel).toBeNull();
    expect(result.monthly).toBeNull();

    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("0");
    expect(result.fiveHour!.limit).toBe("12000");
    expect(result.fiveHour!.remaining).toBe("12000");
    expect(result.fiveHour!.resetTime).toBeNull();

    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.used).toBe("0");
    expect(result.weekly!.limit).toBe("60000");
    expect(result.weekly!.remaining).toBe("60000");
    expect(result.weekly!.resetTime).toBe(WEEKLY_RESET_ISO);

    expect(result.membership).toEqual({ level: "PRO" });
  });

  // Test 2: unknown unit row ignored with warn + warnings populated
  it("ignores unknown unit rows (warns + warnings) and still maps valid rows", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 9,
              number: 9,
              usage: 999,
              currentValue: 1,
              remaining: 998,
            },
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 100,
              remaining: 11900,
            },
          ],
          level: "pro",
        },
        success: true,
      })
    );

    const result = await fetchZhipuUsage(baseCreds);
    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.used).toBe("100");
    expect(result.weekly).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    // Warnings array should contain the skipped row info
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
    expect(result.warnings!.some((w) => w.includes("unit=9"))).toBe(true);
  });

  // Test 3: zero mapped windows (limits contains only non-decodable rows)
  it("throws when no CREDIT_LIMIT rows decode to known windows", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            // Unknown type — not CREDIT_LIMIT
            {
              type: "TOKENS_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 0,
              remaining: 12000,
            },
          ],
          level: "pro",
        },
        success: true,
      })
    );

    await expect(fetchZhipuUsage(baseCreds)).rejects.toThrow(
      "未识别到可用的配额窗口（CREDIT_LIMIT）"
    );
    // Even though it throws, console.warn should have been called for the skipped row
    expect(warnSpy).toHaveBeenCalled();
  });

  // Test 3b: unknown type row → warnings populated before throw does not happen
  // (when some valid rows exist alongside unknown types)
  it("populates warnings for unknown type rows alongside valid rows", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            {
              type: "TOKENS_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 0,
              remaining: 12000,
            },
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 100,
              remaining: 11900,
            },
          ],
          level: "pro",
        },
        success: true,
      })
    );

    const result = await fetchZhipuUsage(baseCreds);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes("TOKENS_LIMIT"))).toBe(true);
  });

  // Test 4: same-bucket conflict → higher usage wins
  it("keeps the row with higher limit when two rows claim the same bucket", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 5000,
              currentValue: 100,
              remaining: 4900,
            },
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 200,
              remaining: 11800,
            },
          ],
          level: "pro",
        },
        success: true,
      })
    );

    const result = await fetchZhipuUsage(baseCreds);
    expect(result.fiveHour!.limit).toBe("12000");
    expect(result.fiveHour!.used).toBe("200");
    expect(result.fiveHour!.remaining).toBe("11800");
  });

  // Test 5: empty limits
  it("throws when limits is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: { limits: [], level: "pro" },
        success: true,
      })
    );

    await expect(fetchZhipuUsage(baseCreds)).rejects.toThrow(
      "未检测到 Coding Plan 订阅"
    );
  });

  // Test 6: envelope failure
  it("throws envelope msg when success is false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 401,
        msg: "Invalid authentication key",
        success: false,
      })
    );

    await expect(fetchZhipuUsage(baseCreds)).rejects.toThrow(
      "Invalid authentication key"
    );
  });

  // Test 7: level missing → membership null
  it("returns membership null when level is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 0,
              remaining: 12000,
            },
          ],
        },
        success: true,
      })
    );

    const result = await fetchZhipuUsage(baseCreds);
    expect(result.membership).toBeNull();
  });

  // Test 8: exhausted-state mapping
  it("maps currentValue===usage to used===limit (exhausted)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 12000,
              remaining: 0,
            },
          ],
          level: "pro",
        },
        success: true,
      })
    );

    const result = await fetchZhipuUsage(baseCreds);
    expect(result.fiveHour!.used).toBe("12000");
    expect(result.fiveHour!.limit).toBe("12000");
    expect(result.fiveHour!.remaining).toBe("0");
  });

  // Test 9 (usage part): HTTP 401 → throw
  it("throws on HTTP non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    await expect(fetchZhipuUsage(baseCreds)).rejects.toThrow(
      "Zhipu usage API returned 500"
    );
  });

  // Test 10: apiKey missing
  it("throws when apiKey is missing", async () => {
    await expect(fetchZhipuUsage({})).rejects.toThrow("API Key not configured");
    await expect(fetchZhipuUsage({ apiKey: "" })).rejects.toThrow(
      "API Key not configured"
    );
  });

  it("sends bare apiKey in Authorization header (no Bearer prefix)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockResponse(REAL_FIXTURE));

    await fetchZhipuUsage(baseCreds);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://open.bigmodel.cn/api/monitor/usage/quota/limit");
    const headers = options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("zhipu_test_key");
  });
});

// ── testZhipuConnection ─────────────────────────────────────────────────────

describe("testZhipuConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns failure when apiKey is missing", async () => {
    const result = await testZhipuConnection({});
    expect(result).toEqual({ ok: false, message: "API Key 未配置" });
  });

  it("returns failure when apiKey is empty string", async () => {
    const result = await testZhipuConnection({ apiKey: "" });
    expect(result).toEqual({ ok: false, message: "API Key 未配置" });
  });

  it("returns 'API Key 无效' on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 401));

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "API Key 无效" });
  });

  it("returns 'API Key 无效' on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 403));

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "API Key 无效" });
  });

  it("returns generic failure on other non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "API 返回 500" });
  });

  it("returns failure on envelope error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ code: 400, msg: "bad request", success: false })
    );

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "bad request" });
  });

  it("returns failure when limits is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: { limits: [], level: "pro" },
        success: true,
      })
    );

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "未检测到 Coding Plan 订阅",
    });
  });

  it("returns success with level on valid response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(REAL_FIXTURE));

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({ ok: true, message: "已连接 (PRO)" });
  });

  it("returns success without level suffix when level is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        code: 200,
        msg: "ok",
        data: {
          limits: [
            {
              type: "CREDIT_LIMIT",
              unit: 3,
              number: 5,
              usage: 12000,
              currentValue: 0,
              remaining: 12000,
            },
          ],
        },
        success: true,
      })
    );

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({ ok: true, message: "已连接" });
  });

  it("returns failure on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNRESET: network down")
    );

    const result = await testZhipuConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "ECONNRESET: network down",
    });
  });
});
