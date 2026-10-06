import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchFangzhouModels } from "@/lib/providers/fangzhou";

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

// ── fetchFangzhouModels ────────────────────────────────────────────────────

describe("fetchFangzhouModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when AK/SK is missing", async () => {
    await expect(fetchFangzhouModels({})).rejects.toThrow("AK/SK not configured");
    await expect(fetchFangzhouModels({ ak: "", sk: "x" })).rejects.toThrow(
      "AK/SK not configured"
    );
  });

  it("fetches single page and extracts Item Names", async () => {
    const listResponse = {
      ResponseMetadata: {
        RequestId: "abc-123",
        Action: "ListFoundationModels",
      },
      Result: {
        Items: [
          { Name: "doubao-pro-32k", DisplayName: "Doubao Pro 32K" },
          { Name: "doubao-lite-32k", DisplayName: "Doubao Lite 32K" },
        ],
        TotalCount: 2,
        PageNumber: 1,
        PageSize: 20,
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    const result = await fetchFangzhouModels(baseCreds);

    expect(result).toEqual(["doubao-pro-32k", "doubao-lite-32k"]);

    const fetchSpy = vi.mocked(globalThis.fetch);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain("Action=ListFoundationModels");
    expect(url).toContain("Version=2024-01-01");
    expect(opts!.headers).toBeDefined();
    const headers = opts!.headers as Record<string, string>;
    expect(headers.Authorization).toContain("HMAC-SHA256");
  });

  it("paginates to fetch all models", async () => {
    const page1 = {
      ResponseMetadata: { RequestId: "1" },
      Result: {
        Items: [{ Name: "model-a" }, { Name: "model-b" }],
        TotalCount: 5,
        PageNumber: 1,
        PageSize: 2,
      },
    };
    const page2 = {
      ResponseMetadata: { RequestId: "2" },
      Result: {
        Items: [{ Name: "model-c" }, { Name: "model-d" }],
        TotalCount: 5,
        PageNumber: 2,
        PageSize: 2,
      },
    };
    const page3 = {
      ResponseMetadata: { RequestId: "3" },
      Result: {
        Items: [{ Name: "model-e" }],
        TotalCount: 5,
        PageNumber: 3,
        PageSize: 2,
      },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2))
      .mockResolvedValueOnce(mockResponse(page3));

    const result = await fetchFangzhouModels(baseCreds);

    expect(result).toEqual([
      "model-a",
      "model-b",
      "model-c",
      "model-d",
      "model-e",
    ]);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it("stops at defensive limit of 1000 items", async () => {
    // Mock responses that always have more pages
    const makeResponse = (pageNumber: number) => ({
      ResponseMetadata: { RequestId: String(pageNumber) },
      Result: {
        Items: Array.from({ length: 100 }, (_, i) => ({
          Name: `model-${pageNumber}-${i}`,
        })),
        TotalCount: 2000,
        PageNumber: pageNumber,
        PageSize: 100,
      },
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const callCount = vi.mocked(globalThis.fetch).mock.calls.length;
      return mockResponse(makeResponse(callCount));
    });

    const result = await fetchFangzhouModels(baseCreds);

    expect(result.length).toBe(1000);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(10);
  });

  it("returns empty array when Items is missing", async () => {
    const listResponse = {
      ResponseMetadata: { RequestId: "1" },
      Result: {},
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    const result = await fetchFangzhouModels(baseCreds);

    expect(result).toEqual([]);
  });

  it("returns empty array when Result is missing", async () => {
    const listResponse = {
      ResponseMetadata: { RequestId: "1" },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    const result = await fetchFangzhouModels(baseCreds);

    expect(result).toEqual([]);
  });

  it("throws on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ message: "forbidden" }, 403)
    );

    await expect(fetchFangzhouModels(baseCreds)).rejects.toThrow(
      "ListFoundationModels API returned 403"
    );
  });

  it("sends proper V4 signed headers", async () => {
    const listResponse = {
      ResponseMetadata: { RequestId: "1" },
      Result: {
        Items: [{ Name: "model-a" }],
        TotalCount: 1,
        PageNumber: 1,
        PageSize: 20,
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(listResponse)
    );

    await fetchFangzhouModels(baseCreds);

    const fetchSpy = vi.mocked(globalThis.fetch);
    const [url, opts] = fetchSpy.mock.calls[0];
    const headers = opts!.headers as Record<string, string>;

    // Verify V4 signature headers
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Content-Sha256"]).toBeDefined();
    expect(headers["X-Date"]).toBeDefined();
    expect(headers.Authorization).toMatch(/HMAC-SHA256 Credential=test-ak/);
  });
});
