import { describe, it, expect } from "vitest";
import {
  resolveModelsHandler,
  resolveModelsHandlerKey,
  normalizeModels,
  modelsHandlers,
} from "@/lib/providers";
import { defaultProviders, type Provider } from "@/lib/types";

function findProvider(id: string): Provider {
  const provider = defaultProviders.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Provider ${id} not found in defaultProviders`);
  }
  return provider;
}

// ============ resolveModelsHandlerKey ============

describe("resolveModelsHandlerKey", () => {
  it("returns provider:planId when planId is provided", () => {
    expect(resolveModelsHandlerKey("moonshot", "kimi-code")).toBe(
      "moonshot:kimi-code"
    );
  });

  it("returns bare provider when planId is undefined", () => {
    expect(resolveModelsHandlerKey("deepseek")).toBe("deepseek");
  });

  it("returns bare provider when planId is empty string", () => {
    expect(resolveModelsHandlerKey("deepseek", "")).toBe("deepseek");
  });
});

// ============ resolveModelsHandler ============

describe("resolveModelsHandler", () => {
  it("returns no-models-api-url when provider has no modelsApiUrl", () => {
    const provider = findProvider("anthropic");
    const result = resolveModelsHandler(provider);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-models-api-url");
    }
  });

  it("returns no-models-api-url when plan has no modelsApiUrl and provider has none", () => {
    const provider = findProvider("anthropic");
    const result = resolveModelsHandler(provider, "some-plan");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-models-api-url");
    }
  });

  it("resolves provider-level modelsApiUrl when no planId", () => {
    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelsApiUrl).toBe("https://api.deepseek.com/models");
    }
  });

  it("resolves plan-level modelsApiUrl over provider-level", () => {
    const provider = findProvider("moonshot");
    const result = resolveModelsHandler(provider, "kimi-code");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelsApiUrl).toBe("https://api.kimi.com/coding/v1/models");
    }
  });

  it("falls back to provider-level when plan has no modelsApiUrl", () => {
    const provider = findProvider("moonshot");
    // moonshot has provider-level modelsApiUrl but kimi-code plan also has one
    // let's test with a plan that doesn't override
    const result = resolveModelsHandler(provider, "nonexistent-plan");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelsApiUrl).toBe("https://api.moonshot.cn/v1/models");
    }
  });

  it("returns no-models-api-url when plan exists but has no modelsApiUrl and provider has none", () => {
    const provider = findProvider("zhipu");
    // zhipu has no provider-level modelsApiUrl, only plan-level
    const result = resolveModelsHandler(provider, "nonexistent-plan");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-models-api-url");
    }
  });

  it("resolves plan-level modelsApiUrl for zhipu coding-plan", () => {
    const provider = findProvider("zhipu");
    const result = resolveModelsHandler(provider, "coding-plan");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelsApiUrl).toBe(
        "https://open.bigmodel.cn/api/coding/paas/v4/models"
      );
    }
  });

  it("resolves plan-level modelsApiUrl for alibaba token-plan", () => {
    const provider = findProvider("alibaba");
    const result = resolveModelsHandler(provider, "token-plan");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelsApiUrl).toBe(
        "https://modelstudio.cn-beijing.aliyuncs.com/modelstudio/models"
      );
    }
  });

  it("returns no-models-api-url for alibaba coding-plan (no modelsApiUrl)", () => {
    const provider = findProvider("alibaba");
    const result = resolveModelsHandler(provider, "coding-plan");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-models-api-url");
    }
  });

  it("uses generic fallback handler when no exception handler registered", () => {
    const provider = findProvider("deepseek");
    const result = resolveModelsHandler(provider);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should have a handler (the generic fallback)
      expect(result.handler).toBeDefined();
      expect(typeof result.handler.fetchModels).toBe("function");
    }
  });

  it("falls back to the bare-provider exception handler when the plan key misses", () => {
    // fangzhou subscriptions carry planId (codingplan/agentplan) but the
    // exception registry only holds the bare "fangzhou" key — the two-step
    // lookup must resolve the exception handler, not the generic fallback
    // that would send a Bearer header to the signed endpoint.
    const provider = findProvider("fangzhou");
    const result = resolveModelsHandler(provider, "codingplan");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handler).toBe(modelsHandlers.fangzhou);
    }
  });

  it("falls back to the bare-provider exception handler for alibaba token-plan", () => {
    const provider = findProvider("alibaba");
    const result = resolveModelsHandler(provider, "token-plan");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handler).toBe(modelsHandlers.alibaba);
    }
  });
});

// ============ normalizeModels ============

describe("normalizeModels", () => {
  it("deduplicates model ids", () => {
    const models = ["model-a", "model-b", "model-a", "model-c", "model-b"];
    const result = normalizeModels(models);
    expect(result).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("sorts model ids by localeCompare", () => {
    const models = ["model-c", "model-a", "model-b"];
    const result = normalizeModels(models);
    expect(result).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("deduplicates and sorts", () => {
    const models = ["zebra", "alpha", "zebra", "beta", "alpha"];
    const result = normalizeModels(models);
    expect(result).toEqual(["alpha", "beta", "zebra"]);
  });

  it("handles empty array", () => {
    const result = normalizeModels([]);
    expect(result).toEqual([]);
  });

  it("handles single element", () => {
    const result = normalizeModels(["only-one"]);
    expect(result).toEqual(["only-one"]);
  });

  it("handles case-sensitive sorting (lowercase first in localeCompare)", () => {
    const models = ["Zebra", "alpha", "Beta"];
    const result = normalizeModels(models);
    // localeCompare default behavior
    expect(result).toEqual(["alpha", "Beta", "Zebra"]);
  });

  it("preserves model id format (no transformation)", () => {
    const models = ["gpt-4", "claude-3-opus", "gemini-pro"];
    const result = normalizeModels(models);
    expect(result).toEqual(["claude-3-opus", "gemini-pro", "gpt-4"]);
  });
});
