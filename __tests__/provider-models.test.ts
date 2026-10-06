import { describe, it, expect } from "vitest";
import { defaultProviders, type Provider } from "@/lib/types";
import type { ModelsHandler } from "@/lib/providers";
import type { ModelsResult } from "@/lib/types";

function findProvider(id: string): Provider {
  const provider = defaultProviders.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Provider ${id} not found in defaultProviders`);
  }
  return provider;
}

function planModelsApiUrl(
  providerId: string,
  planId: string
): string | undefined {
  return findProvider(providerId).plans?.find((p) => p.id === planId)
    ?.modelsApiUrl;
}

// ============ Provider-level modelsApiUrl ============

describe("defaultProviders modelsApiUrl (provider level)", () => {
  it("github uses the Copilot models endpoint", () => {
    expect(findProvider("github").modelsApiUrl).toBe(
      "https://api.githubcopilot.com/models"
    );
  });

  it("deepseek uses the standard models endpoint", () => {
    expect(findProvider("deepseek").modelsApiUrl).toBe(
      "https://api.deepseek.com/models"
    );
  });

  it("siliconflow uses the v1 models endpoint", () => {
    expect(findProvider("siliconflow").modelsApiUrl).toBe(
      "https://api.siliconflow.cn/v1/models"
    );
  });

  it("openrouter uses the public catalog endpoint", () => {
    expect(findProvider("openrouter").modelsApiUrl).toBe(
      "https://openrouter.ai/api/v1/models"
    );
  });

  it("fangzhou uses the shared control-plane ListFoundationModels endpoint (both plans)", () => {
    const provider = findProvider("fangzhou");
    expect(provider.modelsApiUrl).toBe(
      "https://ark.cn-beijing.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01"
    );
    // Provider-level URL covers both plans (same Ark account directory).
    for (const plan of provider.plans ?? []) {
      expect(plan.modelsApiUrl).toBeUndefined();
    }
  });

  it("moonshot platform key uses the platform models endpoint", () => {
    expect(findProvider("moonshot").modelsApiUrl).toBe(
      "https://api.moonshot.cn/v1/models"
    );
  });
});

// ============ Plan-level modelsApiUrl overrides ============

describe("defaultProviders modelsApiUrl (plan level)", () => {
  it("moonshot kimi-code plan overrides with its coding endpoint", () => {
    expect(planModelsApiUrl("moonshot", "kimi-code")).toBe(
      "https://api.kimi.com/coding/v1/models"
    );
  });

  it("zhipu coding-plan uses the coding endpoint (plan level only)", () => {
    expect(planModelsApiUrl("zhipu", "coding-plan")).toBe(
      "https://open.bigmodel.cn/api/coding/paas/v4/models"
    );
    // Zhipu has no platform-key models endpoint: plan-level only.
    expect(findProvider("zhipu").modelsApiUrl).toBeUndefined();
  });

  it("alibaba token-plan uses modelstudio ListModels (plan level only)", () => {
    expect(planModelsApiUrl("alibaba", "token-plan")).toBe(
      "https://modelstudio.cn-beijing.aliyuncs.com/modelstudio/models"
    );
    expect(planModelsApiUrl("alibaba", "coding-plan")).toBeUndefined();
    expect(findProvider("alibaba").modelsApiUrl).toBeUndefined();
  });

  it("opencode go plan uses the zen go models endpoint", () => {
    expect(planModelsApiUrl("opencode", "go")).toBe(
      "https://opencode.ai/zen/go/v1/models"
    );
  });
});

// ============ Coverage: exactly the 9 query-plumbed providers ============

describe("models query coverage", () => {
  it("exactly the 9 query-plumbed providers are models-capable", () => {
    const capable = defaultProviders
      .filter(
        (p) => p.modelsApiUrl || p.plans?.some((plan) => plan.modelsApiUrl)
      )
      .map((p) => p.id)
      .sort();
    expect(capable).toEqual(
      [
        "github",
        "alibaba",
        "moonshot",
        "deepseek",
        "zhipu",
        "siliconflow",
        "openrouter",
        "fangzhou",
        "opencode",
      ].sort()
    );
  });

  it("catalog-only providers have no models endpoint at any level", () => {
    const catalogOnly = [
      "anthropic",
      "openai",
      "google",
      "minimax",
      "byteDance",
      "baidu",
      "xiaomi",
      "xunfei",
      "ollama",
      "lmstudio",
      "local",
      "other",
    ];
    for (const id of catalogOnly) {
      const provider = findProvider(id);
      expect(provider.modelsApiUrl).toBeUndefined();
      for (const plan of provider.plans ?? []) {
        expect(plan.modelsApiUrl).toBeUndefined();
      }
    }
  });
});

// ============ ModelsHandler / ModelsResult contract ============

describe("ModelsHandler contract", () => {
  it("is satisfiable by fetchModels alone (no testConnection)", async () => {
    const handler: ModelsHandler = {
      fetchModels: (credentials) => {
        expect(credentials).toEqual({ apiKey: "test-key" });
        return Promise.resolve(["model-b", "model-a"]);
      },
    };
    await expect(
      handler.fetchModels({ apiKey: "test-key" })
    ).resolves.toEqual(["model-b", "model-a"]);
  });
});

describe("ModelsResult contract", () => {
  it("matches the API wire shape { models: string[] }", () => {
    const result: ModelsResult = { models: ["model-a", "model-b"] };
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      models: ["model-a", "model-b"],
    });
  });
});
