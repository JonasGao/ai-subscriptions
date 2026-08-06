import { UsageResult, UsageWindow, UsageLimitWindow } from "@/lib/types";
import { signVolcengineRequest } from "@/lib/volcengine-signer";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const USAGE_URL = "https://open.volcengineapi.com/open/GetAFPUsage";
const TEST_URL = "https://open.volcengineapi.com/open/ListSubscribeTrade";
function periodToUsageWindow(period: {
  Used: number;
  Total: number;
  Percent: number;
  ResetTimestamp: number;
}): UsageWindow {
  return {
    used: String(period.Used),
    limit: String(period.Total),
    remaining: String(period.Total - period.Used),
    resetTime: String(period.ResetTimestamp),
  };
}

function periodToLimitWindow(
  period: { Used: number; Total: number; ResetTimestamp: number },
  duration: number,
  timeUnit: string
): UsageLimitWindow {
  return {
    window: { duration, timeUnit },
    detail: {
      used: String(period.Used),
      limit: String(period.Total),
      remaining: String(period.Total - period.Used),
      resetTime: String(period.ResetTimestamp),
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

  if (!result || !Array.isArray(result.Periods)) {
    throw new Error("Account not subscribed to AgentPlan");
  }

  const periods = result.Periods as Array<{
    Label: string;
    Used: number;
    Total: number;
    Percent: number;
    ResetTimestamp: number;
  }>;

  const period5h = periods.find((p) => p.Label === "5h");
  const periodWeekly = periods.find((p) => p.Label === "weekly");
  const periodMonthly = periods.find((p) => p.Label === "monthly");

  const usage = periodWeekly ? periodToUsageWindow(periodWeekly) : null;

  const limits: UsageLimitWindow[] = [];
  if (period5h) {
    limits.push(periodToLimitWindow(period5h, 5, "TIME_UNIT_HOUR"));
  }
  if (periodMonthly) {
    limits.push(periodToLimitWindow(periodMonthly, 30, "TIME_UNIT_DAY"));
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
