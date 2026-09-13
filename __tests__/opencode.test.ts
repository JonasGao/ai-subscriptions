import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchOpencodeGoUsage,
  testOpencodeConnection,
} from "@/lib/providers/opencode";

// ── helpers ─────────────────────────────────────────────────────────────────

function mockResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const baseCreds = { apiKey: "oc_test_key" };

const REAL_FIXTURE = {
  usage: {
    rolling: {
      status: "ok",
      percent: 0,
      resetsAt: "2026-09-13T11:26:17.325Z",
    },
    weekly: {
      status: "ok",
      percent: 23,
      resetsAt: "2026-09-14T00:00:00.325Z",
    },
    monthly: {
      status: "ok",
      percent: 11,
      resetsAt: "2026-10-10T11:03:46.325Z",
    },
  },
};

// ── fetchOpencodeGoUsage ────────────────────────────────────────────────────

describe("fetchOpencodeGoUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when apiKey is missing", async () => {
    await expect(fetchOpencodeGoUsage({})).rejects.toThrow("API Key 未配置");
    await expect(fetchOpencodeGoUsage({ apiKey: "" })).rejects.toThrow(
      "API Key 未配置"
    );
  });

  it("synthesizes real fixture into three windows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(REAL_FIXTURE));

    const result = await fetchOpencodeGoUsage(baseCreds);

    expect(result.provider).toBe("opencode");
    expect(result.boosterWallet).toBeNull();
    expect(result.parallel).toBeNull();
    expect(result.membership).toBeNull();

    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.limit).toBe("100");
    expect(result.fiveHour!.used).toBe("0");
    expect(result.fiveHour!.remaining).toBe("100");
    expect(result.fiveHour!.resetTime).toBe("2026-09-13T11:26:17.325Z");

    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.limit).toBe("100");
    expect(result.weekly!.used).toBe("23");
    expect(result.weekly!.remaining).toBe("77");
    expect(result.weekly!.resetTime).toBe("2026-09-14T00:00:00.325Z");

    expect(result.monthly).not.toBeNull();
    expect(result.monthly!.limit).toBe("100");
    expect(result.monthly!.used).toBe("11");
    expect(result.monthly!.remaining).toBe("89");
    expect(result.monthly!.resetTime).toBe("2026-10-10T11:03:46.325Z");
  });

  it("maps rolling → fiveHour bucket", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          rolling: {
            status: "ok",
            percent: 50,
            resetsAt: "2026-09-13T12:00:00Z",
          },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour!.used).toBe("50");
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
  });

  it("returns null windows when only weekly exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          weekly: {
            status: "ok",
            percent: 42,
            resetsAt: "2026-09-14T00:00:00Z",
          },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour).toBeNull();
    expect(result.weekly!.used).toBe("42");
    expect(result.monthly).toBeNull();
  });

  it("rate-limited + percent<100 → used=100, remaining=0 (forced exhaust)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          rolling: {
            status: "rate-limited",
            percent: 60,
            resetsAt: "2026-09-13T12:00:00Z",
          },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour!.used).toBe("100");
    expect(result.fiveHour!.remaining).toBe("0");
    expect(result.fiveHour!.limit).toBe("100");
  });

  it("rate-limited + percent>100 → preserves overage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          weekly: {
            status: "rate-limited",
            percent: 105,
            resetsAt: "2026-09-14T00:00:00Z",
          },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.weekly!.used).toBe("105");
    expect(result.weekly!.remaining).toBe("0");
  });

  it("percent>100 without rate-limited → used=105 (overage preserved, not clamped)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          monthly: {
            status: "ok",
            percent: 105,
            resetsAt: "2026-10-10T11:00:00Z",
          },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.monthly!.used).toBe("105");
    expect(result.monthly!.remaining).toBe("0");
  });

  it("missing percent defaults to 0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          rolling: { status: "ok", resetsAt: "2026-09-13T12:00:00Z" },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour!.used).toBe("0");
    expect(result.fiveHour!.remaining).toBe("100");
  });

  it("missing resetsAt → resetTime null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        usage: {
          rolling: { status: "ok", percent: 10 },
        },
      })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour!.resetTime).toBeNull();
  });

  it("empty usage → all windows null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ usage: {} })
    );

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour).toBeNull();
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
  });

  it("missing usage key → all windows null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}));

    const result = await fetchOpencodeGoUsage(baseCreds);
    expect(result.fiveHour).toBeNull();
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
  });

  it("throws on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "unauthorized" }, 401)
    );

    await expect(fetchOpencodeGoUsage(baseCreds)).rejects.toThrow(
      "API Key 无效或未配置"
    );
  });

  it("throws on other non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    await expect(fetchOpencodeGoUsage(baseCreds)).rejects.toThrow(
      "API 返回 500"
    );
  });

  it("sends correct URL and Bearer header", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockResponse({ usage: {} }));

    await fetchOpencodeGoUsage(baseCreds);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://opencode.ai/zen/go/v1/usage");
    const headers = options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer oc_test_key");
    expect(headers.Accept).toBe("application/json");
  });
});

// ── testOpencodeConnection ──────────────────────────────────────────────────

describe("testOpencodeConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns failure when apiKey is missing", async () => {
    const result = await testOpencodeConnection({});
    expect(result).toEqual({ ok: false, message: "API Key 未配置" });
  });

  it("returns failure when apiKey is empty string", async () => {
    const result = await testOpencodeConnection({ apiKey: "" });
    expect(result).toEqual({ ok: false, message: "API Key 未配置" });
  });

  it("returns success on 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ usage: {} })
    );

    const result = await testOpencodeConnection(baseCreds);
    expect(result).toEqual({ ok: true, message: "已配置" });
  });

  it("returns failure on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 401));

    const result = await testOpencodeConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "API Key 无效或未配置" });
  });

  it("returns failure on other non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    const result = await testOpencodeConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "API 返回 500" });
  });

  it("returns failure on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNRESET: network down")
    );

    const result = await testOpencodeConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "ECONNRESET: network down",
    });
  });

  it("returns failure with stringified error when error is not an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("weird string error");

    const result = await testOpencodeConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "weird string error",
    });
  });
});
