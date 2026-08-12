import { BalanceResult } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

export async function fetchSiliconFlowBalance(
  apiKey: string
): Promise<BalanceResult> {
  const response = await fetchWithTimeout(
    "https://api.siliconflow.cn/v1/user/info",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("SiliconFlow API error:", response.status, errorText);
    throw new Error(`SiliconFlow API returned ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== 20000 || !data.status) {
    console.error("SiliconFlow API error:", data);
    throw new Error(data.message || "SiliconFlow API error");
  }

  const totalBalance = data.data?.totalBalance;
  const balance = data.data?.balance;
  const chargeBalance = data.data?.chargeBalance;
  const status = data.data?.status;

  if (!totalBalance || !status) {
    throw new Error("Unexpected SiliconFlow API response format");
  }

  return {
    provider: "siliconflow",
    isAvailable: status === "normal" && parseFloat(totalBalance) > 0,
    balanceInfos: [
      {
        currency: "CNY",
        available: parseFloat(totalBalance).toFixed(2),
        total: null,
        toppedUp: parseFloat(chargeBalance || "0").toFixed(2),
        granted: parseFloat(balance || "0").toFixed(2),
        used: null,
        frozen: null,
      },
    ],
  };
}

export async function testSiliconFlowConnection(
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchWithTimeout(
      "https://api.siliconflow.cn/v1/user/info",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      DEFAULT_TIMEOUT
    );
    if (!response.ok)
      return { ok: false, message: `API 返回 ${response.status}` };
    const data = await response.json();
    if (data.code === 20000 && data.status)
      return { ok: true, message: "连接成功" };
    return { ok: false, message: data.message || "API 返回错误" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
