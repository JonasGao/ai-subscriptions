import { UsageResult, UsageWindow } from "@/lib/types";
import { signVolcengineRequest } from "@/lib/volcengine-signer";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const USAGE_URL =
  "https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01";
const TEST_URL =
  "https://open.volcengineapi.com/?Action=ListSubscribeTrade&Version=2024-01-01";

/**
 * Map a single QuotaUsage row to a UsageWindow.
 * - Percent is 0-100, used directly as `used`.
 * - Cap is the percent-scale limit (typically 100); falls back to 100 if missing.
 * - ResetTimestamp is epoch seconds; ×1000 → ISO. Zero → null (same convention
 *   as opencode's absent resetsAt).
 */
function rowToUsageWindow(
  percent: number,
  cap: number | undefined,
  resetTimestampSeconds: number
): UsageWindow {
  const limit = cap ?? 100;
  return {
    used: String(percent),
    limit: String(limit),
    remaining: String(limit - percent),
    // ResetTimestamp is epoch seconds; convert to ISO for the frontend
    // (formatNextResetTime parses an ISO string, not a bare ms number)
    resetTime:
      resetTimestampSeconds === 0
        ? null
        : new Date(resetTimestampSeconds * 1000).toISOString(),
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

  // Real API shape (production capture 2026-09-20):
  // { Level: "session"|"weekly"|"monthly", Percent, ResetTimestamp, Cap, RewardTotalPercent }
  // The original handler mistakenly matched on `Label` (which never existed).
  const quotas = result.QuotaUsage as Array<{
    Level: string;
    Percent: number;
    ResetTimestamp: number;
    Cap?: number;
    RewardTotalPercent?: number;
  }>;

  const warnings: string[] = [];

  let sessionRow: (typeof quotas)[number] | null = null;
  let weeklyRow: (typeof quotas)[number] | null = null;
  let monthlyRow: (typeof quotas)[number] | null = null;

  for (const q of quotas) {
    switch (q.Level) {
      case "session":
        sessionRow = q;
        break;
      case "weekly":
        weeklyRow = q;
        break;
      case "monthly":
        monthlyRow = q;
        break;
      default:
        // Unknown Level — skip but surface to the user via warnings
        console.warn(
          `fangzhou-codingplan: skipping unrecognized Level: ${q.Level}`
        );
        warnings.push(`未识别的配额窗口: ${q.Level}`);
    }
  }

  return {
    provider: "fangzhou",
    // session is the short rolling window → fiveHour slot
    fiveHour: sessionRow
      ? rowToUsageWindow(
          sessionRow.Percent,
          sessionRow.Cap,
          sessionRow.ResetTimestamp
        )
      : null,
    weekly: weeklyRow
      ? rowToUsageWindow(
          weeklyRow.Percent,
          weeklyRow.Cap,
          weeklyRow.ResetTimestamp
        )
      : null,
    monthly: monthlyRow
      ? rowToUsageWindow(
          monthlyRow.Percent,
          monthlyRow.Cap,
          monthlyRow.ResetTimestamp
        )
      : null,
    boosterWallet: null,
    parallel: null,
    membership: null,
    ...(warnings.length > 0 && { warnings }),
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
