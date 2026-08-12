import { BalanceResult } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

export async function fetchDeepSeekBalance(
  apiKey: string
): Promise<BalanceResult> {
  const response = await fetchWithTimeout(
    "https://api.deepseek.com/user/balance",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DEFAULT_TIMEOUT
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
      }) => {
        const toFixed2 = (v: string) => {
          const n = parseFloat(v);
          return (Number.isFinite(n) ? n : 0).toFixed(2);
        };
        return {
          currency: info.currency || "USD",
          available: toFixed2(info.total_balance || "0"),
          total: null,
          toppedUp: toFixed2(info.topped_up_balance || "0"),
          granted: toFixed2(info.granted_balance || "0"),
          used: null,
          frozen: null,
        };
      }
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
      DEFAULT_TIMEOUT
    );
    if (response.ok) return { ok: true, message: "连接成功" };
    return { ok: false, message: `API 返回 ${response.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
