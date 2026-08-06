import { UsageResult, BalanceResult } from "@/lib/types";
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
  moonshot: {
    fetchUsage: (creds) =>
      fetchMoonshotUsage(creds.apiKey, "https://api.kimi.com/coding/v1/usages"),
    testConnection: (creds) => testMoonshotConnection(creds.apiKey),
  },
  "fangzhou-agentplan": {
    fetchUsage: (creds) => fetchAgentPlanUsage(creds),
    testConnection: (creds) => testAgentPlanConnection(creds),
  },
  "fangzhou-codingplan": {
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
