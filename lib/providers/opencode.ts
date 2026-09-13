import { UsageResult, UsageWindow } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const API_URL = "https://opencode.ai/zen/go/v1/usage";

/**
 * OpenCode Go usage API returns, per window:
 *   { status?: string; percent?: number; resetsAt?: string }
 * where percent is 0–100+ (can exceed 100 on overage).
 *
 * Synthesis per ADR-0010:
 *   limit="100", used=String(percent), remaining=String(max(0,100-percent))
 * When status==="rate-limited", used = max(percent, 100) so auto-exhaust fires
 * even if percent < 100 (throttled = effectively exhausted). The max preserves
 * a true percent > 100 overage.
 */
interface OpenCodeUsageWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

interface OpenCodeUsageResponse {
  usage?: {
    rolling?: OpenCodeUsageWindow;
    weekly?: OpenCodeUsageWindow;
    monthly?: OpenCodeUsageWindow;
  };
}

function synthesizeWindow(w: OpenCodeUsageWindow): UsageWindow {
  const pct = typeof w.percent === "number" ? w.percent : 0;
  const usedNum = w.status === "rate-limited" ? Math.max(pct, 100) : pct;
  return {
    limit: "100",
    used: String(usedNum),
    remaining: String(Math.max(0, 100 - usedNum)),
    resetTime: w.resetsAt ?? null,
  };
}

export async function fetchOpencodeGoUsage(
  credentials: Record<string, string>
): Promise<UsageResult> {
  const apiKey = credentials.apiKey;
  if (!apiKey) {
    throw new Error("API Key 未配置");
  }

  const response = await fetchWithTimeout(
    API_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    DEFAULT_TIMEOUT
  );

  if (response.status === 401) {
    throw new Error("API Key 无效或未配置");
  }
  if (!response.ok) {
    throw new Error(`API 返回 ${response.status}`);
  }

  const data = (await response.json()) as OpenCodeUsageResponse;
  const windows = data.usage ?? {};

  const fiveHour = windows.rolling ? synthesizeWindow(windows.rolling) : null;
  const weekly = windows.weekly ? synthesizeWindow(windows.weekly) : null;
  const monthly = windows.monthly ? synthesizeWindow(windows.monthly) : null;

  return {
    provider: "opencode",
    fiveHour,
    weekly,
    monthly,
    boosterWallet: null,
    parallel: null,
    membership: null,
  };
}

export async function testOpencodeConnection(
  credentials: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const apiKey = credentials.apiKey;
  if (!apiKey) {
    return { ok: false, message: "API Key 未配置" };
  }

  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      DEFAULT_TIMEOUT
    );

    if (response.status === 401) {
      return { ok: false, message: "API Key 无效或未配置" };
    }
    if (!response.ok) {
      return { ok: false, message: `API 返回 ${response.status}` };
    }

    return { ok: true, message: "已配置" };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
