import { UsageResult, UsageWindow, UsageLimitWindow } from "@/lib/types";
import { signVolcengineRequest } from "@/lib/volcengine-signer";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const USAGE_URL =
  "https://open.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01";
const TEST_URL =
  "https://open.volcengineapi.com/?Action=ListSubscribeTrade&Version=2024-01-01";
function periodToUsageWindow(period: {
  Used: number;
  Quota: number;
  ResetTime: number;
}): UsageWindow {
  return {
    used: String(period.Used),
    limit: String(period.Quota),
    remaining: String(period.Quota - period.Used),
    resetTime: String(period.ResetTime),
  };
}

function periodToLimitWindow(
  period: { Used: number; Quota: number; ResetTime: number },
  duration: number,
  timeUnit: string
): UsageLimitWindow {
  return {
    window: { duration, timeUnit },
    detail: {
      used: String(period.Used),
      limit: String(period.Quota),
      remaining: String(period.Quota - period.Used),
      resetTime: String(period.ResetTime),
    },
  };
}

export async function fetchAgentPlanUsage(
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
    console.error("AgentPlan usage API error:", response.status, errorText);
    throw new Error(`AgentPlan usage API returned ${response.status}`);
  }

  const data = await response.json();
  const result = data?.Result;

  // Actual API returns a flat object, not the Periods[] array the doc
  // describes: Result.{AFPFiveHour, AFPWeekly, AFPMonthly, AFPDaily}
  // each with Quota/Used/SubscribeTime/ResetTime. AFPDaily is ignored.
  const afpFiveHour = result?.AFPFiveHour as
    { Used: number; Quota: number; ResetTime: number } | undefined;
  const afpWeekly = result?.AFPWeekly as
    { Used: number; Quota: number; ResetTime: number } | undefined;
  const afpMonthly = result?.AFPMonthly as
    { Used: number; Quota: number; ResetTime: number } | undefined;

  if (!afpWeekly) {
    throw new Error("Account not subscribed to AgentPlan");
  }

  const usage = periodToUsageWindow(afpWeekly);

  const limits: UsageLimitWindow[] = [];
  if (afpFiveHour) {
    limits.push(periodToLimitWindow(afpFiveHour, 5, "TIME_UNIT_HOUR"));
  }
  if (afpMonthly) {
    limits.push(periodToLimitWindow(afpMonthly, 30, "TIME_UNIT_DAY"));
  }

  return {
    provider: "fangzhou-agentplan",
    usage,
    limits,
    boosterWallet: null,
    parallel: null,
    membership: null,
  };
}

export async function testAgentPlanConnection(
  credentials: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const { ak, sk } = credentials;
  if (!ak || !sk) return { ok: false, message: "AK/SK 未配置" };

  try {
    const body = JSON.stringify({ ResourceNames: ["RealAgentPlanPersonal"] });
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

    return { ok: false, message: "未检测到 AgentPlan 订阅" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
