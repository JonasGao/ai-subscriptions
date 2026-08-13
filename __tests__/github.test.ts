import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGithubUsage, testGithubConnection } from "@/lib/providers/github";

// ── helpers ─────────────────────────────────────────────────────────────────

function mockResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const baseCreds = { token: "ghp_test_token" };

// ── fetchGithubUsage ────────────────────────────────────────────────────────

describe("fetchGithubUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when token is missing", async () => {
    await expect(fetchGithubUsage({})).rejects.toThrow("Token 未配置");
    await expect(fetchGithubUsage({ token: "" })).rejects.toThrow(
      "Token 未配置"
    );
  });

  it("maps premium_interactions to monthly window", async () => {
    const resetDate = "2026-09-01T00:00:00Z";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          chat: { entitlement: 9999, remaining: 9999 },
          completions: { entitlement: 9999, remaining: 9999 },
          premium_interactions: { entitlement: 1000, remaining: 750 },
        },
        quota_reset_date: resetDate,
      })
    );

    const result = await fetchGithubUsage(baseCreds);

    expect(result.provider).toBe("github");
    expect(result.fiveHour).toBeNull();
    expect(result.weekly).toBeNull();
    expect(result.boosterWallet).toBeNull();
    expect(result.parallel).toBeNull();
    expect(result.membership).toBeNull();
    expect(result.monthly).not.toBeNull();
    expect(result.monthly!.limit).toBe("1000");
    expect(result.monthly!.used).toBe("250"); // 1000 - 750
    expect(result.monthly!.remaining).toBe("750");
    expect(result.monthly!.resetTime).toBe(new Date(resetDate).toISOString());
  });

  it("computes used = entitlement - remaining", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 500, remaining: 100 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly!.used).toBe("400");
    expect(result.monthly!.remaining).toBe("100");
  });

  it("clamps used to 0 when remaining exceeds entitlement", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 100, remaining: 200 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly!.used).toBe("0");
    expect(result.monthly!.remaining).toBe("200");
  });

  it("treats missing remaining as 0 (used = entitlement)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 300 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly!.limit).toBe("300");
    expect(result.monthly!.used).toBe("300");
    expect(result.monthly!.remaining).toBe("0");
  });

  it("returns monthly = null when premium_interactions is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          chat: { entitlement: 9999, remaining: 9999 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly).toBeNull();
  });

  it("returns monthly = null when quota_snapshots is missing entirely", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}));

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly).toBeNull();
  });

  it("returns monthly = null when entitlement is 0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 0, remaining: 0 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly).toBeNull();
  });

  it("returns monthly = null when entitlement is negative", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: -5, remaining: -5 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly).toBeNull();
  });

  it("parses numeric quota_reset_date", async () => {
    const resetTs = 1759363200000; // some ms timestamp
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 100, remaining: 50 },
        },
        quota_reset_date: resetTs,
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly!.resetTime).toBe(new Date(resetTs).toISOString());
  });

  it("leaves resetTime null when quota_reset_date is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 100, remaining: 50 },
        },
      })
    );

    const result = await fetchGithubUsage(baseCreds);
    expect(result.monthly!.resetTime).toBeNull();
  });

  it("throws on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "forbidden" }, 403)
    );

    await expect(fetchGithubUsage(baseCreds)).rejects.toThrow(
      "Copilot usage API returned 403"
    );
  });

  it("throws on 500 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    await expect(fetchGithubUsage(baseCreds)).rejects.toThrow(
      "Copilot usage API returned 500"
    );
  });

  it("sends the required headers", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockResponse({ quota_snapshots: {} }));

    await fetchGithubUsage(baseCreds);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.github.com/copilot_internal/user");
    const headers = options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("token ghp_test_token");
    expect(headers.Accept).toBe("application/json");
    expect(headers["Editor-Version"]).toBe("vscode/1.96.2");
    expect(headers["X-Github-Api-Version"]).toBe("2025-04-01");
  });
});

// ── testGithubConnection ────────────────────────────────────────────────────

describe("testGithubConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns failure when token is missing", async () => {
    const result = await testGithubConnection({});
    expect(result).toEqual({ ok: false, message: "Token 未配置" });
  });

  it("returns failure when token is empty string", async () => {
    const result = await testGithubConnection({ token: "" });
    expect(result).toEqual({ ok: false, message: "Token 未配置" });
  });

  it("returns success on 200 with quota_snapshots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: {
          premium_interactions: { entitlement: 100, remaining: 50 },
        },
      })
    );

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({ ok: true, message: "已配置" });
  });

  it("returns success on 200 even without premium_interactions (quota_snapshots still parseable)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        quota_snapshots: { chat: { entitlement: 5000 } },
      })
    );

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({ ok: true, message: "已配置" });
  });

  it("returns failure on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "bad credentials" }, 401)
    );

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({ ok: false, message: "Token 无效或已过期" });
  });

  it("returns failure on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "forbidden" }, 403)
    );

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "接口拒绝请求(可能不支持该 token 类型)",
    });
  });

  it("returns failure on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "not found" }, 404)
    );

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "接口拒绝请求(可能不支持该 token 类型)",
    });
  });

  it("returns failure on other non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}, 500));

    const result = await testGithubConnection(baseCreds);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("500");
  });

  it("returns failure when response is missing quota_snapshots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({}));

    const result = await testGithubConnection(baseCreds);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("quota_snapshots");
  });

  it("returns failure on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ECONNRESET: network down")
    );

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "ECONNRESET: network down",
    });
  });

  it("returns failure with stringified error when error is not an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("weird string error");

    const result = await testGithubConnection(baseCreds);
    expect(result).toEqual({
      ok: false,
      message: "weird string error",
    });
  });
});
