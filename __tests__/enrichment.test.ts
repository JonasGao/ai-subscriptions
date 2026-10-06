import { describe, it, expect } from "vitest";
import type { Provider, Subscription, Tool } from "@/lib/types";
import {
  supportsUsageQuery,
  supportsBalanceQuery,
  supportsModelsQuery,
  enrichProviders,
  getUnregisteredProviderNames,
} from "@/lib/providers/enrichment";

// ============ supportsUsageQuery / supportsBalanceQuery ============

describe("supportsUsageQuery", () => {
  it("deepseek: no usage handler → false", () => {
    expect(supportsUsageQuery("deepseek")).toBe(false);
  });

  it("moonshot: plan-level handler (moonshot:kimi-code) → true", () => {
    expect(supportsUsageQuery("moonshot")).toBe(true);
  });

  it("fangzhou: plan-level handlers (fangzhou:agentplan, fangzhou:codingplan) → true", () => {
    expect(supportsUsageQuery("fangzhou")).toBe(true);
  });

  it("openai: no handlers at all → false", () => {
    expect(supportsUsageQuery("openai")).toBe(false);
  });

  it("unknown provider → false", () => {
    expect(supportsUsageQuery("nonexistent")).toBe(false);
  });
});

describe("supportsBalanceQuery", () => {
  it("deepseek: has balance handler → true", () => {
    expect(supportsBalanceQuery("deepseek")).toBe(true);
  });

  it("moonshot: has balance handler → true", () => {
    expect(supportsBalanceQuery("moonshot")).toBe(true);
  });

  it("fangzhou: no balance handler → false", () => {
    expect(supportsBalanceQuery("fangzhou")).toBe(false);
  });

  it("openai: no handlers → false", () => {
    expect(supportsBalanceQuery("openai")).toBe(false);
  });
});

// ============ supportsModelsQuery ============

describe("supportsModelsQuery", () => {
  it("deepseek: provider-level modelsApiUrl → true", () => {
    const provider: Provider = {
      id: "deepseek",
      name: "DeepSeek",
      modelsApiUrl: "https://api.deepseek.com/models",
    };
    expect(supportsModelsQuery(provider)).toBe(true);
  });

  it("moonshot: provider-level + plan-level modelsApiUrl → true", () => {
    const provider: Provider = {
      id: "moonshot",
      name: "Moonshot",
      modelsApiUrl: "https://api.moonshot.cn/v1/models",
      plans: [
        {
          id: "kimi-code",
          name: "Kimi Code",
          modelsApiUrl: "https://api.kimi.com/coding/v1/models",
        },
      ],
    };
    expect(supportsModelsQuery(provider)).toBe(true);
  });

  it("zhipu: plan-level modelsApiUrl only (no provider-level) → true", () => {
    const provider: Provider = {
      id: "zhipu",
      name: "Zhipu",
      plans: [
        {
          id: "coding-plan",
          name: "Coding Plan",
          modelsApiUrl: "https://open.bigmodel.cn/api/coding/paas/v4/models",
        },
      ],
    };
    expect(supportsModelsQuery(provider)).toBe(true);
  });

  it("openai: no modelsApiUrl anywhere → false", () => {
    const provider: Provider = {
      id: "openai",
      name: "OpenAI",
    };
    expect(supportsModelsQuery(provider)).toBe(false);
  });

  it("provider with modelsApiUrl but NOT in handler registry → still true (key difference from usage/balance)", () => {
    // This is the critical test: supportsModelsQuery derives from URL existence,
    // NOT from handler registry. Generic fallback handlers aren't in the registry.
    const provider: Provider = {
      id: "siliconflow",
      name: "SiliconFlow",
      modelsApiUrl: "https://api.siliconflow.cn/v1/models",
    };
    expect(supportsModelsQuery(provider)).toBe(true);
  });

  it("provider with plans but none have modelsApiUrl → false", () => {
    const provider: Provider = {
      id: "alibaba",
      name: "Alibaba",
      plans: [
        { id: "coding-plan", name: "Coding Plan" },
        { id: "token-plan", name: "Token Plan" },
      ],
    };
    expect(supportsModelsQuery(provider)).toBe(false);
  });
});

// ============ enrichProviders ============

function makeProvider(id: string): Provider {
  return { id, name: id };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-x",
    name: "sub",
    category: "AI助手",
    provider: "other",
    subscriptionType: "recurring",
    billingCycle: "monthly",
    price: 10,
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: "tool-x",
    name: "tool",
    category: "AI助手",
    provider: "other",
    forms: ["Web"],
    order: 0,
    isOpenSource: false,
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("enrichProviders", () => {
  it("derives capability flags from handler registries and modelsApiUrl", () => {
    const providers: Provider[] = [
      {
        id: "deepseek",
        name: "DeepSeek",
        modelsApiUrl: "https://api.deepseek.com/models",
      },
      {
        id: "moonshot",
        name: "Moonshot",
        modelsApiUrl: "https://api.moonshot.cn/v1/models",
        plans: [
          {
            id: "kimi-code",
            name: "Kimi Code",
            modelsApiUrl: "https://api.kimi.com/coding/v1/models",
          },
        ],
      },
      {
        id: "fangzhou",
        name: "Fangzhou",
        modelsApiUrl:
          "https://ark.cn-beijing.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01",
        plans: [
          { id: "codingplan", name: "Coding Plan" },
          { id: "agentplan", name: "Agent Plan" },
        ],
      },
      { id: "openai", name: "OpenAI" },
    ];

    const result = enrichProviders(providers, [], []);

    expect(result[0]).toMatchObject({
      id: "deepseek",
      supportsBalanceQuery: true,
      supportsUsageQuery: false,
      supportsModelsQuery: true,
    });
    expect(result[1]).toMatchObject({
      id: "moonshot",
      supportsBalanceQuery: true,
      supportsUsageQuery: true,
      supportsModelsQuery: true,
    });
    expect(result[2]).toMatchObject({
      id: "fangzhou",
      supportsBalanceQuery: false,
      supportsUsageQuery: true,
      supportsModelsQuery: true,
    });
    expect(result[3]).toMatchObject({
      id: "openai",
      supportsBalanceQuery: false,
      supportsUsageQuery: false,
      supportsModelsQuery: false,
    });
  });

  it("counts subscriptions per provider", () => {
    const subs: Subscription[] = [
      makeSubscription({ id: "s1", provider: "deepseek" }),
      makeSubscription({ id: "s2", provider: "deepseek" }),
      makeSubscription({ id: "s3", provider: "moonshot" }),
      makeSubscription({ id: "s4", provider: "other", providerCustom: "Foo" }),
    ];
    const result = enrichProviders(
      [makeProvider("deepseek"), makeProvider("moonshot")],
      subs,
      []
    );
    expect(result[0].subscriptionCount).toBe(2);
    expect(result[1].subscriptionCount).toBe(1);
  });

  it("counts tools per provider", () => {
    const tools: Tool[] = [
      makeTool({ id: "t1", provider: "openai" }),
      makeTool({ id: "t2", provider: "openai" }),
      makeTool({ id: "t3", provider: "openai" }),
      makeTool({ id: "t4", provider: "other", providerCustom: "Bar" }),
    ];
    const result = enrichProviders([makeProvider("openai")], [], tools);
    expect(result[0].toolCount).toBe(3);
  });

  it("returns zero counts for providers with no refs", () => {
    const result = enrichProviders([makeProvider("openai")], [], []);
    expect(result[0].subscriptionCount).toBe(0);
    expect(result[0].toolCount).toBe(0);
  });
});

// ============ getUnregisteredProviderNames ============

describe("getUnregisteredProviderNames", () => {
  it("groups providerCustom values where provider === 'other'", () => {
    const subs: Subscription[] = [
      makeSubscription({ provider: "other", providerCustom: "FooAPI" }),
      makeSubscription({ provider: "other", providerCustom: "FooAPI" }),
      makeSubscription({ provider: "other", providerCustom: "BarSvc" }),
      makeSubscription({ provider: "deepseek" }), // not "other", ignored
    ];
    const tools: Tool[] = [
      makeTool({ provider: "other", providerCustom: "FooAPI" }),
      makeTool({ provider: "other", providerCustom: "BarSvc" }),
      makeTool({ provider: "other", providerCustom: "BarSvc" }),
    ];

    const result = getUnregisteredProviderNames(subs, tools);

    expect(result).toEqual([
      { name: "BarSvc", count: 3 },
      { name: "FooAPI", count: 3 },
    ]);
  });

  it("sorts by count desc then name asc", () => {
    const subs: Subscription[] = [
      makeSubscription({ provider: "other", providerCustom: "Z" }),
      makeSubscription({ provider: "other", providerCustom: "Z" }),
      makeSubscription({ provider: "other", providerCustom: "A" }),
      makeSubscription({ provider: "other", providerCustom: "A" }),
      makeSubscription({ provider: "other", providerCustom: "M" }),
      makeSubscription({ provider: "other", providerCustom: "M" }),
      makeSubscription({ provider: "other", providerCustom: "Top" }),
      makeSubscription({ provider: "other", providerCustom: "Top" }),
      makeSubscription({ provider: "other", providerCustom: "Top" }),
    ];
    const result = getUnregisteredProviderNames(subs, []);
    expect(result[0]).toEqual({ name: "Top", count: 3 });
    // Counts tied at 2 → alphabetical
    expect(result.slice(1)).toEqual([
      { name: "A", count: 2 },
      { name: "M", count: 2 },
      { name: "Z", count: 2 },
    ]);
  });

  it("ignores empty / whitespace-only providerCustom", () => {
    const subs: Subscription[] = [
      makeSubscription({ provider: "other", providerCustom: "" }),
      makeSubscription({ provider: "other", providerCustom: "   " }),
      makeSubscription({ provider: "other" }), // undefined
    ];
    expect(getUnregisteredProviderNames(subs, [])).toEqual([]);
  });

  it("returns empty when nothing is 'other'", () => {
    const subs: Subscription[] = [makeSubscription({ provider: "deepseek" })];
    const tools: Tool[] = [makeTool({ provider: "openai" })];
    expect(getUnregisteredProviderNames(subs, tools)).toEqual([]);
  });
});
