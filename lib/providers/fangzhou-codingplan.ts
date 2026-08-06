import { UsageResult, UsageWindow } from "@/lib/types";
import { signVolcengineRequest } from "@/lib/volcengine-signer";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const USAGE_URL =
  "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01";
const TEST_URL =
  "https://open.volcengineapi.com/?Action=ListSubscribeTrade&Version=2024-01-01";
function percentToUsageWindow(
  percent: number,
  resetTimestampSeconds: number
): UsageWindow {
  return {
    used: String(percent),
    limit: "100",
    remaining: String(100 - percent),
    // ResetTimestamp is epoch seconds; convert to ISO for the frontend
    // (formatNextResetTime parses an ISO string, not a bare ms number)
    resetTime: new Date(resetTimestampSeconds * 1000).toISOString(),
  };
}

export async function fetchCodingPlanUsage(
  credentials: Record<string, string>
): Promise<UsageResult> {
  const { ak, sk } = credentials;
  if (!ak || !sk) throw new Error("AK/SK not configured");

  const body = JSON.stringify({});
  const headers = signVolcengineRequest({
    method: "POST",
    url: USAGE_URL,
    body,
    ak,
    sk,
  });

  const response = await fetchWithTimeout(
    USAGE_URL,
    { method: "POST", headers, body },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("CodingPlan usage API error:", response.status, errorText);
    throw new Error(`CodingPlan usage API returned ${response.status}`);
  }

  const data = await response.json();
  const result = data?.Result;

  if (
    !result ||
    !Array.isArray(result.QuotaUsage) ||
    result.QuotaUsage.length === 0
  ) {
    throw new Error("Account not subscribed to CodingPlan");
  }

  const quotas = result.QuotaUsage as Array<{
    Label: string;
    Percent: number;
    ResetTimestamp: number;
  }>;

  const session = quotas.find((q) => q.Label === "session");
  const weekly = quotas.find((q) => q.Label === "weekly");
  const monthly = quotas.find((q) => q.Label === "monthly");

  return {
    provider: "fangzhou-codingplan",
    // session is the short rolling window → fiveHour slot
    fiveHour: session
      ? percentToUsageWindow(session.Percent, session.ResetTimestamp)
      : null,
    weekly: weekly
      ? percentToUsageWindow(weekly.Percent, weekly.ResetTimestamp)
      : null,
    monthly: monthly
      ? percentToUsageWindow(monthly.Percent, monthly.ResetTimestamp)
      : null,
    boosterWallet: null,
    parallel: null,
    membership: null,
  };
}

export async function testCodingPlanConnection(
  credentials: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const { ak, sk } = credentials;
  if (!ak || !sk) return { ok: false, message: "AK/SK 未配置" };

  try {
    const body = JSON.stringify({ ResourceNames: [""] });
    const headers = signVolcengineRequest({
      method: "POST",
      url: TEST_URL,
      body,
      ak,
      sk,
    });

    const response = await fetchWithTimeout(
      TEST_URL,
      { method: "POST", headers, body },
      DEFAULT_TIMEOUT
    );

    if (!response.ok) {
      return { ok: false, message: `API 返回 ${response.status}` };
    }

    const data = await response.json();
    const infoList = data?.Result?.InfoList;

    if (Array.isArray(infoList) && infoList.length > 0) {
      const inst = infoList[0];
      return {
        ok: true,
        message: `已订阅 (${inst.BizInfo || "unknown"}, ${inst.Status || "unknown"})`,
      };
    }

    return { ok: false, message: "未检测到 CodingPlan 订阅" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
