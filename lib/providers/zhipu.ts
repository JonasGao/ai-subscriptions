import { UsageResult, UsageWindow } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

const USAGE_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

interface ZhipuLimitRow {
  type?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number;
}

interface ZhipuUsageResponse {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    limits?: ZhipuLimitRow[];
    level?: string;
  };
}

function rowToUsageWindow(row: ZhipuLimitRow): UsageWindow {
  return {
    used: String(row.currentValue ?? 0),
    limit: String(row.usage),
    remaining: String(row.remaining ?? 0),
    // nextResetTime is epoch ms; may be absent on the 5h row
    resetTime:
      typeof row.nextResetTime === "number"
        ? new Date(row.nextResetTime).toISOString()
        : null,
  };
}

export async function fetchZhipuUsage(
  credentials: Record<string, string>
): Promise<UsageResult> {
  const apiKey = credentials.apiKey;
  if (!apiKey) {
    throw new Error("API Key not configured");
  }

  const response = await fetchWithTimeout(
    USAGE_URL,
    {
      method: "GET",
      headers: { Authorization: apiKey },
    },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    console.error("Zhipu usage API error:", response.status);
    throw new Error(`Zhipu usage API returned ${response.status}`);
  }

  const data = (await response.json()) as ZhipuUsageResponse;

  if (data.code !== 200 || data.success === false) {
    throw new Error(data.msg ?? "Zhipu usage API returned failure");
  }

  const limits = data.data?.limits;
  if (!limits || limits.length === 0) {
    throw new Error("未检测到 Coding Plan 订阅");
  }

  let fiveHourRow: ZhipuLimitRow | null = null;
  let weeklyRow: ZhipuLimitRow | null = null;
  const warnings: string[] = [];

  for (const row of limits) {
    if (row.type !== "CREDIT_LIMIT") {
      console.warn("zhipu: ignoring non-CREDIT_LIMIT row", row);
      warnings.push(`未识别的配额类型: ${row.type ?? "(missing)"}`);
      continue;
    }

    const isFiveHour = row.unit === 3 && row.number === 5;
    const isWeekly = row.unit === 6 && row.number === 1;

    if (!isFiveHour && !isWeekly) {
      console.warn(
        "zhipu: ignoring CREDIT_LIMIT row with unknown unit/number",
        row
      );
      warnings.push(`未识别的配额窗口: unit=${row.unit}, number=${row.number}`);
      continue;
    }

    const target = isFiveHour ? "fiveHour" : "weekly";
    const current = isFiveHour ? fiveHourRow : weeklyRow;

    // Same-bucket conflict: keep the row with higher limit (usage)
    if (!current || (row.usage ?? 0) > (current.usage ?? 0)) {
      if (isFiveHour) fiveHourRow = row;
      else weeklyRow = row;
    } else {
      console.warn(
        `zhipu: dropping duplicate ${target} row with lower limit`,
        row
      );
    }
  }

  if (!fiveHourRow && !weeklyRow) {
    throw new Error("未识别到可用的配额窗口（CREDIT_LIMIT）");
  }

  const level = data.data?.level;

  return {
    provider: "zhipu",
    fiveHour: fiveHourRow ? rowToUsageWindow(fiveHourRow) : null,
    weekly: weeklyRow ? rowToUsageWindow(weeklyRow) : null,
    monthly: null,
    boosterWallet: null,
    parallel: null,
    membership: level ? { level: level.toUpperCase() } : null,
    ...(warnings.length > 0 && { warnings }),
  };
}

export async function testZhipuConnection(
  credentials: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const apiKey = credentials.apiKey;
  if (!apiKey) {
    return { ok: false, message: "API Key 未配置" };
  }

  try {
    const response = await fetchWithTimeout(
      USAGE_URL,
      {
        method: "GET",
        headers: { Authorization: apiKey },
      },
      DEFAULT_TIMEOUT
    );

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "API Key 无效" };
    }
    if (!response.ok) {
      return { ok: false, message: `API 返回 ${response.status}` };
    }

    const data = (await response.json()) as ZhipuUsageResponse;

    if (data.code !== 200 || data.success === false) {
      return {
        ok: false,
        message: data.msg ?? "Zhipu usage API returned failure",
      };
    }

    const limits = data.data?.limits;
    if (!limits || limits.length === 0) {
      return { ok: false, message: "未检测到 Coding Plan 订阅" };
    }

    const level = data.data?.level;
    return {
      ok: true,
      message: level ? `已连接 (${level.toUpperCase()})` : "已连接",
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
