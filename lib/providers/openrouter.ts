import { BalanceResult } from "@/lib/types";

const TIMEOUT = 10000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOpenRouterBalance(
  apiKey: string
): Promise<BalanceResult> {
  const response = await fetchWithTimeout(
    "https://openrouter.ai/api/v1/credits",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenRouter API error:", response.status, errorText);
    throw new Error(`OpenRouter API returned ${response.status}`);
  }

  const data = await response.json();

  const totalCredits = data?.data?.total_credits;
  const totalUsage = data?.data?.total_usage;

  if (typeof totalCredits !== "number" || typeof totalUsage !== "number") {
    throw new Error("Unexpected OpenRouter API response format");
  }

  const remainingCredits = (totalCredits - totalUsage).toFixed(2);

  return {
    provider: "openrouter",
    isAvailable: parseFloat(remainingCredits) > 0,
    balanceInfos: [
      {
        currency: "USD",
        totalBalance: remainingCredits,
        grantedBalance: totalCredits.toFixed(2),
        toppedUpBalance: totalUsage.toFixed(2),
      },
    ],
  };
}

export async function testOpenRouterConnection(
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/credits",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      TIMEOUT
    );
    if (response.ok) return { ok: true, message: "连接成功" };
    return { ok: false, message: `API 返回 ${response.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
