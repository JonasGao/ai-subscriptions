import {
  UsageResult,
  BalanceResult,
  Provider,
  Subscription,
} from "@/lib/types";
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
