import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveModelsHandler } from "@/lib/providers";
import { defaultProviders, type Provider } from "@/lib/types";

function findProvider(id: string): Provider {
  const provider = defaultProviders.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Provider ${id} not found in defaultProviders`);
  }
  return provider;
}

describe("generic OpenAI-compatible fetchModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts data[].id from OpenAI-shaped response", async () => {
    const mockResponse = {
      data: [
        { id: "gpt-4", object: "model" },
        { id: "gpt-3.5-turbo", object: "model" },
        { id: "gpt-4", object: "model" }, // duplicate
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const models = await result.handler.fetchModels({ apiKey: "test-key" });
      // Should extract ids (normalizeModels will dedup later in the route)
      expect(models).toEqual(["gpt-4", "gpt-3.5-turbo", "gpt-4"]);
    }
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    } as Response);

    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      await expect(
        result.handler.fetchModels({ apiKey: "bad-key" })
      ).rejects.toThrow("Models query failed: 401 Unauthorized");
    }
  });

  it("throws on invalid response shape (missing data array)", async () => {
    const mockResponse = { models: ["gpt-4"] }; // wrong shape

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      await expect(
        result.handler.fetchModels({ apiKey: "test-key" })
      ).rejects.toThrow("Invalid models response: missing data array");
    }
  });

  it("sends Bearer token when apiKey is provided", async () => {
    const mockResponse = { data: [{ id: "model-1" }] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      await result.handler.fetchModels({ apiKey: "test-api-key" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.deepseek.com/models",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer test-api-key",
          },
        })
      );
    }
  });

  it("works without credentials for public endpoints", async () => {
    const mockResponse = { data: [{ id: "model-1" }] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const provider = findProvider("openrouter");
    const result = resolveModelsHandler(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      await result.handler.fetchModels({});

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: {}, // no Authorization header
        })
      );
    }
  });

  it("filters out items without id", async () => {
    const mockResponse = {
      data: [
        { id: "model-1", object: "model" },
        { object: "model" }, // missing id
        { id: "model-2", object: "model" },
        { id: null, object: "model" }, // null id
        { id: "", object: "model" }, // empty id
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const models = await result.handler.fetchModels({ apiKey: "test-key" });
      expect(models).toEqual(["model-1", "model-2"]);
    }
  });

  it("alibaba token-plan uses generic OpenAI fallback with Bearer token", async () => {
    const mockResponse = {
      object: "list",
      data: [
        { id: "qwen3.7", object: "model", created: 1234567890, owned_by: "alibaba" },
        { id: "deepseek-v3.2", object: "model", created: 1234567890, owned_by: "deepseek" },
        { id: "qwen3.7", object: "model", created: 1234567890, owned_by: "alibaba" }, // duplicate
      ],
      first_id: "qwen3.7",
      last_id: "qwen3.7",
      has_more: false,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const provider = findProvider("alibaba");
    const result = resolveModelsHandler(provider, "token-plan");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const models = await result.handler.fetchModels({ apiKey: "test-api-key" });

      // Should extract ids from data[].id (normalizeModels will dedup later)
      expect(models).toEqual(["qwen3.7", "deepseek-v3.2", "qwen3.7"]);

      // Should call the OpenAI-compatible endpoint
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer test-api-key",
          },
        })
      );
    }
  });
});
