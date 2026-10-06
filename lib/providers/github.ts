import { UsageResult, UsageWindow } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const API_URL = "https://api.github.com/copilot_internal/user";

interface CopilotQuotaSnapshot {
  entitlement?: number;
  remaining?: number;
}

interface CopilotUserResponse {
  quota_snapshots?: {
    chat?: CopilotQuotaSnapshot;
    completions?: CopilotQuotaSnapshot;
    premium_interactions?: CopilotQuotaSnapshot;
  };
  quota_reset_date?: string | number | null;
}

/**
 * Build a UsageWindow from a Copilot premium_interactions quota snapshot.
 * Returns null when the snapshot is missing, has no entitlement, or the
 * entitlement is zero/negative — callers treat this as "no monthly data".
 */
function toMonthlyWindow(
  snapshot: CopilotQuotaSnapshot | undefined,
  resetDate: string | number | null | undefined
): UsageWindow | null {
  if (!snapshot) return null;
  const entitlement = snapshot.entitlement;
  if (!entitlement || entitlement <= 0) return null;

  const remaining = snapshot.remaining ?? 0;
  const used = Math.max(0, entitlement - remaining);

  let resetTime: string | null = null;
  if (resetDate !== undefined && resetDate !== null) {
    const parsed = new Date(resetDate);
    if (!Number.isNaN(parsed.getTime())) {
      resetTime = parsed.toISOString();
    }
  }

  return {
    limit: String(entitlement),
    used: String(used),
    remaining: String(remaining),
    resetTime,
  };
}

export async function fetchGithubUsage(
  credentials: Record<string, string>
): Promise<UsageResult> {
  const token = credentials.token;
  if (!token) {
    throw new Error("Token 未配置");
  }

  const response = await fetchWithTimeout(
    API_URL,
    {
      method: "GET",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/json",
        "Editor-Version": "vscode/1.96.2",
        "X-Github-Api-Version": "2025-04-01",
      },
    },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`Copilot usage API returned ${response.status}`);
  }

  const payload = (await response.json()) as CopilotUserResponse;
  const monthly = toMonthlyWindow(
    payload.quota_snapshots?.premium_interactions,
    payload.quota_reset_date
  );

  return {
    provider: "github",
    fiveHour: null,
    weekly: null,
    monthly,
    boosterWallet: null,
    parallel: null,
    membership: null,
  };
}

export async function testGithubConnection(
  credentials: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const token = credentials.token;
  if (!token) {
    return { ok: false, message: "Token 未配置" };
  }

  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: "GET",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/json",
          "Editor-Version": "vscode/1.96.2",
          "X-Github-Api-Version": "2025-04-01",
        },
      },
      DEFAULT_TIMEOUT
    );

    if (response.status === 401) {
      return { ok: false, message: "Token 无效或已过期" };
    }
    if (response.status === 403 || response.status === 404) {
      return {
        ok: false,
        message: "接口拒绝请求(可能不支持该 token 类型)",
      };
    }
    if (!response.ok) {
      return { ok: false, message: `API 返回 ${response.status}` };
    }

    const payload = (await response.json()) as CopilotUserResponse;
    if (!payload.quota_snapshots) {
      return { ok: false, message: "响应缺少 quota_snapshots" };
    }

    return { ok: true, message: "已配置" };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Model Query ──────────────────────────────────────────────────────────────

const TOKEN_EXCHANGE_URL =
  "https://api.github.com/copilot_internal/v2/token";
const MODELS_API_URL = "https://api.githubcopilot.com/models";

// Module-level cache for the exchanged Copilot token, keyed by PAT
// to prevent token sharing between different GitHub subscriptions.
let cachedPat: string | null = null;
let cachedCopilotToken: string | null = null;
let tokenExpiresAt: number = 0;

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
  endpoints?: {
    api?: string;
  };
}

interface CopilotModel {
  id?: string;
  capabilities?: {
    type?: string;
  };
  policy?: {
    state?: string;
  };
}

interface CopilotModelsResponse {
  data?: CopilotModel[];
}

/**
 * Exchange a GitHub PAT for a short-lived Copilot token.
 * The token is cached at module level until ~5 minutes before expiry.
 * Cache is keyed by PAT to prevent token sharing between subscriptions.
 */
async function exchangeCopilotToken(pat: string): Promise<string> {
  // Check cache first — invalidate if PAT changed
  if (
    cachedPat === pat &&
    cachedCopilotToken &&
    Date.now() < tokenExpiresAt - 5 * 60 * 1000
  ) {
    return cachedCopilotToken;
  }

  const response = await fetchWithTimeout(
    TOKEN_EXCHANGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/json",
        "Editor-Version": "vscode/1.96.2",
      },
    },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`Token exchange API returned ${response.status}`);
  }

  const payload = (await response.json()) as CopilotTokenResponse;
  cachedPat = pat;
  cachedCopilotToken = payload.token;
  tokenExpiresAt = payload.expires_at;

  return cachedCopilotToken;
}

/**
 * Fetch the list of available models for GitHub Copilot.
 * Exchanges the PAT for a short-lived Copilot token, then queries
 * the models endpoint and filters for enabled chat models.
 */
export async function fetchGithubModels(
  credentials: Record<string, string>
): Promise<string[]> {
  const token = credentials.token;
  if (!token) {
    throw new Error("Token 未配置");
  }

  // Exchange PAT for Copilot token
  const copilotToken = await exchangeCopilotToken(token);

  // Fetch models using the Copilot token
  const response = await fetchWithTimeout(
    MODELS_API_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        Accept: "application/json",
      },
    },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`Copilot models API returned ${response.status}`);
  }

  const payload = (await response.json()) as CopilotModelsResponse;
  const models = payload.data ?? [];

  // Filter for enabled chat models (exclude embeddings)
  return models
    .filter((m) => m.policy?.state === "enabled")
    .filter((m) => m.capabilities?.type === "chat")
    .map((m) => m.id)
    .filter((id): id is string => id !== undefined);
}
