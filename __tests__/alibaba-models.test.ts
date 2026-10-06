import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAlibabaModels } from "@/lib/providers/alibaba-tokenplan";

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

// ── fetchAlibabaModels ─────────────────────────────────────────────────────

describe("fetchAlibabaModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when AK/SK is missing", async () => {
    await expect(fetchAlibabaModels({})).rejects.toThrow("AK/SK not configured");
    await expect(fetchAlibabaModels({ ak: "", sk: "x" })).rejects.toThrow(
      "AK/SK not configured"
    );
  });

  it("fetches single page and extracts model ids", async () => {
    const listResponse = {
      totalCount: 2,
      nextToken: null,
      models: [
        {
          model: "qwen-turbo",
          name: "Qwen Turbo",
          provider: "alibaba",
        },
        {
          model: "qwen-plus",
          name: "Qwen Plus",
          provider: "alibaba",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    const result = await fetchAlibabaModels(baseCreds);

    expect(result).toEqual(["qwen-turbo", "qwen-plus"]);

    const fetchSpy = vi.mocked(globalThis.fetch);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain("modelstudio.cn-beijing.aliyuncs.com");
    expect(url).toContain("/modelstudio/models");
    expect(opts!.headers).toBeDefined();
    const headers = opts!.headers as Record<string, string>;
    expect(headers["x-acs-action"]).toBe("ListModels");
    expect(headers["x-acs-version"]).toBe("2026-02-10");
    expect(headers.authorization).toContain("ACS3-HMAC-SHA256");
  });

  it("paginates with nextToken until null", async () => {
    const page1 = {
      totalCount: 5,
      nextToken: "token-page-2",
      models: [{ model: "model-a" }, { model: "model-b" }],
    };
    const page2 = {
      totalCount: 5,
      nextToken: "token-page-3",
      models: [{ model: "model-c" }, { model: "model-d" }],
    };
    const page3 = {
      totalCount: 5,
      nextToken: null,
      models: [{ model: "model-e" }],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2))
      .mockResolvedValueOnce(mockResponse(page3));

    const result = await fetchAlibabaModels(baseCreds);

    expect(result).toEqual(["model-a", "model-b", "model-c", "model-d", "model-e"]);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it("passes nextToken in subsequent requests", async () => {
    const page1 = {
      totalCount: 3,
      nextToken: "token-abc",
      models: [{ model: "model-a" }],
    };
    const page2 = {
      totalCount: 3,
      nextToken: null,
      models: [{ model: "model-b" }],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2));

    await fetchAlibabaModels(baseCreds);

    const fetchSpy = vi.mocked(globalThis.fetch);
    const [url1] = fetchSpy.mock.calls[0];
    const [url2] = fetchSpy.mock.calls[1];

    // First request has no nextToken
    expect(url1).not.toContain("nextToken");

    // Second request includes nextToken
    expect(url2).toContain("nextToken=token-abc");
  });

  it("stops at defensive limit of 1000 items", async () => {
    // Mock responses that always have more pages
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      const pageMatch = urlStr.match(/maxResults=(\d+)/);
      const pageNum = pageMatch ? parseInt(pageMatch[1]) : 100;

      return mockResponse({
        totalCount: 2000,
        nextToken: "next-token",
        models: Array.from({ length: pageNum }, (_, i) => ({
          model: `model-${i}`,
        })),
      });
    });

    const result = await fetchAlibabaModels(baseCreds);

    expect(result.length).toBe(1000);
  });

  it("returns empty array when models is missing", async () => {
    const listResponse = {
      totalCount: 0,
      nextToken: null,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    const result = await fetchAlibabaModels(baseCreds);

    expect(result).toEqual([]);
  });

  it("returns empty array when models is empty", async () => {
    const listResponse = {
      totalCount: 0,
      nextToken: null,
      models: [],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    const result = await fetchAlibabaModels(baseCreds);

    expect(result).toEqual([]);
  });

  it("throws on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "forbidden" }, 403)
    );

    await expect(fetchAlibabaModels(baseCreds)).rejects.toThrow(
      "ListModels API returned 403"
    );
  });

  it("sends proper ACS3 signed headers", async () => {
    const listResponse = {
      totalCount: 1,
      nextToken: null,
      models: [{ model: "qwen-turbo" }],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    await fetchAlibabaModels(baseCreds);

    const fetchSpy = vi.mocked(globalThis.fetch);
    const [, opts] = fetchSpy.mock.calls[0];
    const headers = opts!.headers as Record<string, string>;

    // Verify ACS3 signature headers
    expect(headers["x-acs-action"]).toBe("ListModels");
    expect(headers["x-acs-version"]).toBe("2026-02-10");
    expect(headers["x-acs-date"]).toBeDefined();
    expect(headers["x-acs-signature-nonce"]).toBeDefined();
    expect(headers["x-acs-content-sha256"]).toBeDefined();
    expect(headers.authorization).toMatch(/ACS3-HMAC-SHA256 Credential=test-ak/);
  });
});
