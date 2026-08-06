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

export async function fetchDeepSeekBalance(
  apiKey: string
): Promise<BalanceResult> {
  const response = await fetchWithTimeout(
    "https://api.deepseek.com/user/balance",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("DeepSeek API error:", response.status, errorText);
    throw new Error(`DeepSeek API returned ${response.status}`);
  }

  const data = await response.json();

  return {
    provider: "deepseek",
    isAvailable: data.is_available ?? false,
    balanceInfos: (data.balance_infos || []).map(
      (info: {
        currency: string;
        total_balance: string;
        granted_balance: string;
        topped_up_balance: string;
      }) => ({
        currency: info.currency || "USD",
        totalBalance: info.total_balance || "0",
        grantedBalance: info.granted_balance || "0",
        toppedUpBalance: info.topped_up_balance || "0",
      })
    ),
  };
}

export async function testDeepSeekConnection(
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchWithTimeout(
      "https://api.deepseek.com/user/balance",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      TIMEOUT
    );
    if (response.ok) return { ok: true, message: "连接成功" };
    return { ok: false, message: `API 返回 ${response.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
