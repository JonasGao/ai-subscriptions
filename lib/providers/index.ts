import {
  UsageResult,
  BalanceResult,
  Provider,
  Subscription,
} from "@/lib/types";
import { getProviders } from "@/lib/db";
import {
  fetchMoonshotUsage,
  fetchMoonshotBalance,
  testMoonshotConnection,
} from "./moonshot";
import { fetchDeepSeekBalance, testDeepSeekConnection } from "./deepseek";
import {
  fetchSiliconFlowBalance,
  testSiliconFlowConnection,
} from "./siliconflow";
import { fetchOpenRouterBalance, testOpenRouterConnection } from "./openrouter";
import {
  fetchAgentPlanUsage,
  testAgentPlanConnection,
} from "./fangzhou-agentplan";
import {
  fetchCodingPlanUsage,
  testCodingPlanConnection,
} from "./fangzhou-codingplan";
import {
  fetchTokenPlanUsage,
  testTokenPlanConnection,
} from "./alibaba-tokenplan";
import {
  fetchGithubUsage,
  testGithubConnection,
  fetchGithubModels,
} from "./github";
import { fetchOpencodeGoUsage, testOpencodeConnection } from "./opencode";
import { fetchZhipuUsage, testZhipuConnection } from "./zhipu";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";
import { fetchFangzhouModels } from "./fangzhou";
import { fetchAlibabaModels } from "./alibaba-tokenplan";

export interface UsageHandler {
  fetchUsage(credentials: Record<string, string>): Promise<UsageResult>;
  testConnection(
    credentials: Record<string, string>
  ): Promise<{ ok: boolean; message: string }>;
}

export interface BalanceHandler {
  fetchBalance(credentials: Record<string, string>): Promise<BalanceResult>;
  testConnection(
    credentials: Record<string, string>
  ): Promise<{ ok: boolean; message: string }>;
}

/**
 * Model Query handler: normalizes a provider-specific model list
 * response into plain model ids. Unlike Usage/BalanceHandler there is
 * deliberately no testConnection — credential testing is unrelated to
 * model queries. Only the non-OpenAI-shaped providers (github /
 * fangzhou / alibaba) get bespoke handlers; everything else uses the
 * generic OpenAI-compatible fallback driven by the resolved
 * modelsApiUrl.
 */
export interface ModelsHandler {
  fetchModels(credentials: Record<string, string>): Promise<string[]>;
}

export const usageHandlers: Record<string, UsageHandler> = {
  "moonshot:kimi-code": {
    fetchUsage: (creds) =>
      fetchMoonshotUsage(creds.apiKey, "https://api.kimi.com/coding/v1/usages"),
    testConnection: (creds) => testMoonshotConnection(creds.apiKey),
  },
  "fangzhou:agentplan": {
    fetchUsage: (creds) => fetchAgentPlanUsage(creds),
    testConnection: (creds) => testAgentPlanConnection(creds),
  },
  "fangzhou:codingplan": {
    fetchUsage: (creds) => fetchCodingPlanUsage(creds),
    testConnection: (creds) => testCodingPlanConnection(creds),
  },
  "alibaba:token-plan": {
    fetchUsage: (creds) => fetchTokenPlanUsage(creds),
    testConnection: (creds) => testTokenPlanConnection(creds),
  },
  github: {
    fetchUsage: (creds) => fetchGithubUsage(creds),
    testConnection: (creds) => testGithubConnection(creds),
  },
  "opencode:go": {
    fetchUsage: (creds) => fetchOpencodeGoUsage(creds),
    testConnection: (creds) => testOpencodeConnection(creds),
  },
  "zhipu:coding-plan": {
    fetchUsage: (creds) => fetchZhipuUsage(creds),
    testConnection: (creds) => testZhipuConnection(creds),
  },
};

export const balanceHandlers: Record<string, BalanceHandler> = {
  moonshot: {
    fetchBalance: (creds) => fetchMoonshotBalance(creds.apiKey),
    testConnection: (creds) => testMoonshotConnection(creds.apiKey),
  },
  deepseek: {
    fetchBalance: (creds) => fetchDeepSeekBalance(creds.apiKey),
    testConnection: (creds) => testDeepSeekConnection(creds.apiKey),
  },
  siliconflow: {
    fetchBalance: (creds) => fetchSiliconFlowBalance(creds.apiKey),
    testConnection: (creds) => testSiliconFlowConnection(creds.apiKey),
  },
  openrouter: {
    fetchBalance: (creds) => fetchOpenRouterBalance(creds.apiKey),
    testConnection: (creds) => testOpenRouterConnection(creds.apiKey),
  },
};

/**
 * Exception handlers for non-OpenAI-shaped providers.
 * These providers require bespoke API calls (token exchange, V4 signing, ACS3 signing)
 * rather than the generic OpenAI-compatible fetch.
 * Registration keys follow the same pattern as usage/balance handlers:
 * - Bare provider id (e.g. "github", "fangzhou", "alibaba")
 * - Or "provider:planId" when plans need different handlers (not needed for these three)
 */
export const modelsHandlers: Record<string, ModelsHandler> = {
  github: {
    fetchModels: (creds) => fetchGithubModels(creds),
  },
  fangzhou: {
    fetchModels: (creds) => fetchFangzhouModels(creds),
  },
  alibaba: {
    fetchModels: (creds) => fetchAlibabaModels(creds),
  },
};

/**
 * Resolves the handler key for a subscription's usage query.
 * If the subscription has a planId, returns "providerId:planId";
 * otherwise returns the bare provider id.
 */
export function resolveUsageHandlerKey(subscription: Subscription): string {
  if (subscription.planId) {
    return `${subscription.provider}:${subscription.planId}`;
  }
  return subscription.provider;
}

/**
 * Resolves the usage API URL for a subscription.
 * If the subscription has a planId and the provider has plans,
 * returns the plan-level usageApiUrl; otherwise returns the
 * provider-level usageApiUrl.
 */
export function resolveUsageApiUrl(
  provider: Provider,
  planId?: string
): string | undefined {
  if (planId && provider.plans) {
    const plan = provider.plans.find((p) => p.id === planId);
    if (plan?.usageApiUrl) {
      return plan.usageApiUrl;
    }
  }
  return provider.usageApiUrl;
}

/**
 * Resolves the usage handler and API URL for a subscription in one call.
 * Returns either a success result with the handler and URL, or a failure
 * result with a reason code.
 */
export type ResolveUsageHandlerResult =
  | { ok: true; handler: UsageHandler; usageApiUrl: string }
  | {
      ok: false;
      reason: "not-recurring" | "no-usage-api-url" | "no-handler";
    };

export function resolveUsageHandler(
  subscription: Subscription
): ResolveUsageHandlerResult {
  if (subscription.subscriptionType !== "recurring") {
    return { ok: false, reason: "not-recurring" };
  }

  const providers = getProviders();
  const providerConfig = providers.find(
    (p: Provider) => p.id === subscription.provider
  );
  const usageApiUrl = providerConfig
    ? resolveUsageApiUrl(providerConfig, subscription.planId)
    : undefined;

  if (!usageApiUrl) {
    return { ok: false, reason: "no-usage-api-url" };
  }

  const handlerKey = resolveUsageHandlerKey(subscription);
  const handler = usageHandlers[handlerKey];

  if (!handler) {
    return { ok: false, reason: "no-handler" };
  }

  return { ok: true, handler, usageApiUrl };
}

/**
 * Resolves the handler key for a provider/plan's models query.
 * If planId is provided (and non-empty), returns "providerId:planId";
 * otherwise returns the bare provider id.
 */
export function resolveModelsHandlerKey(
  provider: string,
  planId?: string
): string {
  if (planId) {
    return `${provider}:${planId}`;
  }
  return provider;
}

/**
 * Resolves the models API URL for a provider/plan.
 * If planId is provided and the provider has plans,
 * returns the plan-level modelsApiUrl; otherwise returns the
 * provider-level modelsApiUrl.
 */
export function resolveModelsApiUrl(
  provider: Provider,
  planId?: string
): string | undefined {
  if (planId && provider.plans) {
    const plan = provider.plans.find((p) => p.id === planId);
    if (plan?.modelsApiUrl) {
      return plan.modelsApiUrl;
    }
  }
  return provider.modelsApiUrl;
}

/**
 * Generic OpenAI-compatible models fetcher. Extracts data[].id from
 * the response. Works for any provider with an OpenAI-shaped models
 * endpoint (deepseek / siliconflow / openrouter / moonshot / zhipu /
 * opencode / etc.). Exception handlers (github / fangzhou / alibaba)
 * override this in later tickets.
 */
async function fetchGenericModels(
  modelsApiUrl: string,
  credentials: Record<string, string>
): Promise<string[]> {
  const headers: Record<string, string> = {};
  // Some providers (openrouter, opencode) have public endpoints; others
  // need a Bearer token. apiKey is the common credential field.
  if (credentials.apiKey) {
    headers["Authorization"] = `Bearer ${credentials.apiKey}`;
  }

  const response = await fetchWithTimeout(
    modelsApiUrl,
    { method: "GET", headers },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(
      `Models query failed: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  // OpenAI shape: { data: [{ id: "..." }, ...] }
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Invalid models response: missing data array");
  }

  return data.data.map((item: { id: string }) => item.id).filter(Boolean);
}

/**
 * Pure function: deduplicates and sorts model ids by localeCompare.
 * Reused by the API route after handler-specific normalization.
 */
export function normalizeModels(models: string[]): string[] {
  const unique = Array.from(new Set(models));
  return unique.sort((a, b) => a.localeCompare(b));
}

/**
 * Resolves the models handler and API URL for a provider/plan in one call.
 * Returns either a success result with the handler and URL, or a failure
 * result with a reason code.
 */
export type ResolveModelsHandlerResult =
  | { ok: true; handler: ModelsHandler; modelsApiUrl: string }
  | { ok: false; reason: "no-models-api-url" };

export function resolveModelsHandler(
  provider: Provider,
  planId?: string
): ResolveModelsHandlerResult {
  const modelsApiUrl = resolveModelsApiUrl(provider, planId);

  if (!modelsApiUrl) {
    return { ok: false, reason: "no-models-api-url" };
  }

  const handlerKey = resolveModelsHandlerKey(provider.id, planId);
  const exceptionHandler = modelsHandlers[handlerKey];

  // Use exception handler if registered; otherwise use generic fallback.
  const handler: ModelsHandler = exceptionHandler || {
    fetchModels: (creds) => fetchGenericModels(modelsApiUrl, creds),
  };

  return { ok: true, handler, modelsApiUrl };
}
