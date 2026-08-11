import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchTokenPlanUsage,
  testTokenPlanConnection,
  buildAcsCanonicalQuery,
  signAcsRequest,
} from "@/lib/providers/alibaba-tokenplan";

// ── ACS signing ──────────────────────────────────────────────────────────────

describe("buildAcsCanonicalQuery", () => {
  it("sorts params by key and percent-encodes", () => {
    const result = buildAcsCanonicalQuery({
      WorkspaceId: "ws_test",
      NamespaceId: "namespace-1",
    });
    // "NamespaceId" < "WorkspaceId" alphabetically
    expect(result).toBe("NamespaceId=namespace-1&WorkspaceId=ws_test");
  });

  it("expands arrays to Key.N=V1 style", () => {
    const result = buildAcsCanonicalQuery({
      StatusList: ["NORMAL", "LIMIT"],
    });
    expect(result).toBe("StatusList.1=NORMAL&StatusList.2=LIMIT");
  });

  it("skips undefined and empty values", () => {
    const result = buildAcsCanonicalQuery({
      WorkspaceId: "ws_test",
      Empty: "",
      Missing: undefined,
      PageNo: 1,
    });
    expect(result).toBe("PageNo=1&WorkspaceId=ws_test");
  });

  it("percent-encodes RFC 3986 reserved chars", () => {
    const result = buildAcsCanonicalQuery({
      Key: "a+b'c(d)e",
    });
    // RFC 3986 reserved: ! ' ( ) *
    // encodeURI leaves them, encodeRFC3986 escapes them
    expect(result).toMatch(/%/);
    expect(result).not.toMatch(/[!'()*]/);
  });
});

describe("signAcsRequest", () => {
  it("returns all required ACS headers", () => {
    const headers = signAcsRequest({
      accessKeyId: "test-ak-id",
      accessKeySecret: "test-ak-secret",
      action: "GetSubscriptionSeatDetails",
      version: "2026-02-10",
      body: "",
      host: "modelstudio.cn-beijing.aliyuncs.com",
      pathname: "/tokenplan/subscription/seat-detail",
      method: "GET",
      queryString: "NamespaceId=namespace-1&WorkspaceId=ws_test",
    });

    expect(headers["host"]).toBe("modelstudio.cn-beijing.aliyuncs.com");
    expect(headers["x-acs-action"]).toBe("GetSubscriptionSeatDetails");
    expect(headers["x-acs-version"]).toBe("2026-02-10");
    expect(headers["x-acs-date"]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    );
    expect(headers["x-acs-signature-nonce"]).toBeTruthy();
    expect(headers["x-acs-content-sha256"]).toBe(
      // sha256 of empty string
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toMatch(
      /^ACS3-HMAC-SHA256 Credential=test-ak-id,SignedHeaders=[^,]+,Signature=[0-9a-f]{64}$/
    );
  });

  it("includes the expected signed headers in the authorization", () => {
    const headers = signAcsRequest({
      accessKeyId: "ak",
      accessKeySecret: "sk",
      action: "GetSubscriptionSeatDetails",
      version: "2026-02-10",
      body: "",
      host: "modelstudio.cn-beijing.aliyuncs.com",
      pathname: "/tokenplan/subscription/seat-detail",
      method: "GET",
      queryString: "",
    });
    // SignedHeaders should be a sorted, semicolon-joined list of header keys
    // that are "host", "content-type", or start with "x-acs-".
    const match = headers.authorization.match(/SignedHeaders=([^,]+)/);
    expect(match).toBeTruthy();
    const signedHeaders = match![1].split(";");
    expect(signedHeaders).toEqual([
      "content-type",
      "host",
      "x-acs-action",
      "x-acs-content-sha256",
      "x-acs-date",
      "x-acs-signature-nonce",
      "x-acs-version",
    ]);
  });

  it("is deterministic when nonce and date are held constant", () => {
    const headersA = signAcsRequest({
      accessKeyId: "ak",
      accessKeySecret: "sk",
      action: "GetSubscriptionSeatDetails",
      version: "2026-02-10",
      body: "",
      host: "modelstudio.cn-beijing.aliyuncs.com",
      pathname: "/tokenplan/subscription/seat-detail",
      method: "GET",
      queryString: "WorkspaceId=ws_test",
      dateISO: "2026-08-11T00:00:00Z",
      nonce: "fixed-uuid-for-test",
    });
    const headersB = signAcsRequest({
      accessKeyId: "ak",
      accessKeySecret: "sk",
      action: "GetSubscriptionSeatDetails",
      version: "2026-02-10",
      body: "",
      host: "modelstudio.cn-beijing.aliyuncs.com",
      pathname: "/tokenplan/subscription/seat-detail",
      method: "GET",
      queryString: "WorkspaceId=ws_test",
      dateISO: "2026-08-11T00:00:00Z",
      nonce: "fixed-uuid-for-test",
    });

    expect(headersA.authorization).toBe(headersB.authorization);
    expect(headersA["x-acs-signature-nonce"]).toBe("fixed-uuid-for-test");
    expect(headersA["x-acs-date"]).toBe("2026-08-11T00:00:00Z");
  });

  it("different secret → different signature", () => {
    const headersA = signAcsRequest({
      accessKeyId: "ak",
      accessKeySecret: "sk-a",
      action: "A",
      version: "V",
      body: "",
      host: "h",
      pathname: "/p",
      method: "GET",
      queryString: "",
      dateISO: "2026-08-11T00:00:00Z",
      nonce: "fixed-uuid",
    });
    const headersB = signAcsRequest({
      accessKeyId: "ak",
      accessKeySecret: "sk-b",
      action: "A",
      version: "V",
      body: "",
      host: "h",
      pathname: "/p",
      method: "GET",
      queryString: "",
      dateISO: "2026-08-11T00:00:00Z",
      nonce: "fixed-uuid",
    });

    const sigA = headersA.authorization.match(/Signature=([0-9a-f]+)$/)?.[1];
    const sigB = headersB.authorization.match(/Signature=([0-9a-f]+)$/)?.[1];
    expect(sigA).not.toBe(sigB);
  });
});

// ── fetchTokenPlanUsage ──────────────────────────────────────────────────────

describe("fetchTokenPlanUsage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseCreds = {
    ak: "test-ak",
    sk: "test-sk",
    workspaceId: "ws_test",
  };

  function mockSeatResponse(items: unknown[]) {
    const mockResponse = {
      Success: true,
      Data: { Items: items, Total: items.length, PageNo: 1, PageSize: 10 },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);
  }

  it("maps a single 5h equity to fiveHour slot", async () => {
    const now = Date.now();
    mockSeatResponse([
      {
        SeatId: "seat-1",
        Status: "NORMAL",
        EquityList: [
          {
            CycleStartTime: now - 5 * 3600 * 1000,
            CycleEndTime: now + 0,
            CycleTotalValue: 1000000,
            CycleSurplusValue: 700000,
          },
        ],
      },
    ]);

    const result = await fetchTokenPlanUsage(baseCreds);

    expect(result.provider).toBe("alibaba");
    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.limit).toBe("1000000");
    expect(result.fiveHour!.used).toBe("300000");
    expect(result.fiveHour!.remaining).toBe("700000");
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
  });

  it("classifies equities into fiveHour/weekly/monthly by cycle duration", async () => {
    const now = Date.now();
    mockSeatResponse([
      {
        SeatId: "seat-1",
        Status: "NORMAL",
        EquityList: [
          {
            // 5h cycle → fiveHour
            CycleStartTime: now - 5 * 3600 * 1000,
            CycleEndTime: now,
            CycleTotalValue: 100,
            CycleSurplusValue: 50,
          },
          {
            // 7-day cycle → weekly
            CycleStartTime: now - 7 * 24 * 3600 * 1000,
            CycleEndTime: now,
            CycleTotalValue: 5000,
            CycleSurplusValue: 2500,
          },
          {
            // 30-day cycle → monthly
            CycleStartTime: now - 30 * 24 * 3600 * 1000,
            CycleEndTime: now,
            CycleTotalValue: 20000,
            CycleSurplusValue: 10000,
          },
        ],
      },
    ]);

    const result = await fetchTokenPlanUsage(baseCreds);

    expect(result.fiveHour).not.toBeNull();
    expect(result.fiveHour!.limit).toBe("100");
    expect(result.fiveHour!.remaining).toBe("50");

    expect(result.weekly).not.toBeNull();
    expect(result.weekly!.limit).toBe("5000");
    expect(result.weekly!.remaining).toBe("2500");

    expect(result.monthly).not.toBeNull();
    expect(result.monthly!.limit).toBe("20000");
    expect(result.monthly!.remaining).toBe("10000");
  });

  it("picks higher-limit equity when multiple map to the same window", async () => {
    const now = Date.now();
    mockSeatResponse([
      {
        SeatId: "seat-1",
        EquityList: [
          {
            CycleStartTime: now - 5 * 3600 * 1000,
            CycleEndTime: now,
            CycleTotalValue: 100,
            CycleSurplusValue: 80,
          },
        ],
      },
      {
        SeatId: "seat-2",
        EquityList: [
          {
            CycleStartTime: now - 5 * 3600 * 1000,
            CycleEndTime: now,
            CycleTotalValue: 500, // higher limit wins
            CycleSurplusValue: 400,
          },
        ],
      },
    ]);

    const result = await fetchTokenPlanUsage(baseCreds);

    expect(result.fiveHour!.limit).toBe("500");
    expect(result.fiveHour!.remaining).toBe("400");
  });

  it("skips equities with zero/missing CycleTotalValue", async () => {
    const now = Date.now();
    mockSeatResponse([
      {
        SeatId: "seat-1",
        EquityList: [
          {
            CycleStartTime: now - 5 * 3600 * 1000,
            CycleEndTime: now,
            CycleTotalValue: 0, // zero → skip
            CycleSurplusValue: 0,
          },
          {
            CycleStartTime: now - 5 * 3600 * 1000,
            CycleEndTime: now,
            // CycleTotalValue missing
            CycleSurplusValue: 100,
          },
        ],
      },
    ]);

    const result = await fetchTokenPlanUsage(baseCreds);

    expect(result.fiveHour).toBeNull();
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
  });

  it("uses resetTime from CycleEndTime (ms → ISO)", async () => {
    const endTime = 1717049200000;
    mockSeatResponse([
      {
        SeatId: "seat-1",
        EquityList: [
          {
            CycleStartTime: endTime - 5 * 3600 * 1000,
            CycleEndTime: endTime,
            CycleTotalValue: 1000,
            CycleSurplusValue: 500,
          },
        ],
      },
    ]);

    const result = await fetchTokenPlanUsage(baseCreds);

    expect(result.fiveHour!.resetTime).toBe(new Date(endTime).toISOString());
  });

  it("returns all-null windows when equity list is empty", async () => {
    mockSeatResponse([{ SeatId: "seat-1", EquityList: [] }]);

    const result = await fetchTokenPlanUsage(baseCreds);

    expect(result.fiveHour).toBeNull();
    expect(result.weekly).toBeNull();
    expect(result.monthly).toBeNull();
  });

  it("throws on missing AK/SK", async () => {
    await expect(
      fetchTokenPlanUsage({ ak: "", sk: "sk", workspaceId: "ws" })
    ).rejects.toThrow("AK/SK not configured");
    await expect(
      fetchTokenPlanUsage({ ak: "ak", sk: "", workspaceId: "ws" })
    ).rejects.toThrow("AK/SK not configured");
  });

  it("throws on missing WorkspaceId", async () => {
    await expect(
      fetchTokenPlanUsage({ ak: "ak", sk: "sk", workspaceId: "" })
    ).rejects.toThrow("WorkspaceId not configured");
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as unknown as Response);

    await expect(fetchTokenPlanUsage(baseCreds)).rejects.toThrow(
      "TokenPlan usage API returned 403"
    );
  });

  it("throws when no seats returned", async () => {
    const mockResponse = {
      Success: false,
      Code: "NoSubscription",
      Message: "No active subscription",
      Data: { Items: [], Total: 0 },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    await expect(fetchTokenPlanUsage(baseCreds)).rejects.toThrow(
      /No active TokenPlan seats/
    );
  });

  it("builds the endpoint URL with host override", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        Success: false,
        Data: { Items: [] },
      }),
      text: async () => "{}",
    } as Response);

    try {
      await fetchTokenPlanUsage({
        ...baseCreds,
        host: "modelstudio.ap-southeast-1.aliyuncs.com",
      });
    } catch {
      // expected — empty items throws
    }

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(
      /^https:\/\/modelstudio\.ap-southeast-1\.aliyuncs\.com\/tokenplan\/subscription\/seat-detail\?/
    );
  });
});

// ── testTokenPlanConnection ──────────────────────────────────────────────────

describe("testTokenPlanConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok:false when AK/SK missing", async () => {
    const result = await testTokenPlanConnection({
      ak: "",
      sk: "sk",
      workspaceId: "ws",
    });
    expect(result).toEqual({ ok: false, message: "AK/SK 未配置" });
  });

  it("returns ok:false when WorkspaceId missing", async () => {
    const result = await testTokenPlanConnection({
      ak: "ak",
      sk: "sk",
      workspaceId: "",
    });
    expect(result).toEqual({ ok: false, message: "Workspace ID 未配置" });
  });

  it("returns ok:true with seat count on success", async () => {
    const mockResponse = {
      Success: true,
      Data: { Items: [{ SeatId: "s1" }], Total: 3 },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await testTokenPlanConnection({
      ak: "ak",
      sk: "sk",
      workspaceId: "ws",
    });
    expect(result).toEqual({ ok: true, message: "已订阅 (3 个席位)" });
  });

  it("returns ok:false when Total is 0", async () => {
    const mockResponse = {
      Success: true,
      Data: { Items: [], Total: 0 },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await testTokenPlanConnection({
      ak: "ak",
      sk: "sk",
      workspaceId: "ws",
    });
    expect(result).toEqual({
      ok: false,
      message: "未检测到 Token Plan 订阅",
    });
  });

  it("returns ok:false on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    const result = await testTokenPlanConnection({
      ak: "ak",
      sk: "sk",
      workspaceId: "ws",
    });
    expect(result).toEqual({ ok: false, message: "API 返回 500" });
  });

  it("returns ok:false on API-level failure", async () => {
    const mockResponse = {
      Success: false,
      Message: "InvalidWorkspaceId",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const result = await testTokenPlanConnection({
      ak: "ak",
      sk: "sk",
      workspaceId: "ws",
    });
    expect(result).toEqual({ ok: false, message: "InvalidWorkspaceId" });
  });

  it("returns ok:false on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await testTokenPlanConnection({
      ak: "ak",
      sk: "sk",
      workspaceId: "ws",
    });
    expect(result).toEqual({ ok: false, message: "network down" });
  });
});
