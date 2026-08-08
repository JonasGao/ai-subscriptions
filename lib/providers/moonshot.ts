import { UsageResult, UsageWindow, BalanceResult } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

function windowHours(duration: number, timeUnit: string): number {
  switch (timeUnit) {
    case "TIME_UNIT_SECOND":
      return duration / 3600;
    case "TIME_UNIT_MINUTE":
      return duration / 60;
    case "TIME_UNIT_HOUR":
      return duration;
    case "TIME_UNIT_DAY":
      return duration * 24;
    default:
      return -1;
  }
}

function normalizeUsageWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const limit = record.limit;
  // proto3 JSON omits zero-valued fields — derive whichever side is missing
  let used = record.used;
  let remaining = record.remaining;
  if (used === undefined && limit !== undefined && remaining !== undefined) {
    used = String(Number(limit) - Number(remaining));
  }
  if (remaining === undefined && limit !== undefined && used !== undefined) {
    remaining = String(Number(limit) - Number(used));
  }
  const resetTime = record.resetTime ?? record.reset_time;
  if (
    limit === undefined ||
    used === undefined ||
    remaining === undefined ||
    resetTime === undefined
  )
    return null;
  return {
    limit: String(limit),
    used: String(used),
    remaining: String(remaining),
    resetTime: String(resetTime),
  };
}

export async function fetchMoonshotUsage(
  apiKey: string,
  usageApiUrl: string
): Promise<UsageResult> {
  const response = await fetchWithTimeout(
    usageApiUrl,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Moonshot usage API error:", response.status, errorText);
    throw new Error(`Moonshot usage API returned ${response.status}`);
  }

  const data = await response.json();

  // Top-level usage is the weekly quota (7-day window)
  const weekly = normalizeUsageWindow(data?.usage);

  // limits[] are windowed quotas keyed by their duration; pick the
  // 5-hour rolling window and the 30-day monthly window, ignore the rest
  const rawLimits: unknown[] = Array.isArray(data?.limits) ? data.limits : [];
  const pickLimitWindow = (hours: number): UsageWindow | null => {
    for (const item of rawLimits) {
      const record = item as Record<string, unknown>;
      const windowRaw = record.window;
      if (!windowRaw || typeof windowRaw !== "object") continue;
      const windowRecord = windowRaw as Record<string, unknown>;
      if (
        windowHours(
          Number(windowRecord.duration) || 0,
          String(windowRecord.timeUnit ?? "")
        ) === hours
      ) {
        return normalizeUsageWindow(record.detail);
      }
    }
    return null;
  };
  const fiveHour = pickLimitWindow(5);
  const monthly = pickLimitWindow(24 * 30);

  const boosterWalletRaw = data?.boosterWallet;
  const boosterWallet =
    boosterWalletRaw && typeof boosterWalletRaw === "object"
      ? (() => {
          const boosterRecord = boosterWalletRaw as Record<string, unknown>;
          const balanceRaw = boosterRecord.balance;
          const monthlyUsedRaw = boosterRecord.monthlyUsed;
          return {
            balance:
              balanceRaw && typeof balanceRaw === "object"
                ? {
                    amount: String(
                      (balanceRaw as Record<string, unknown>).amount ?? ""
                    ),
                    amountLeft: String(
                      (balanceRaw as Record<string, unknown>).amountLeft ?? ""
                    ),
                    unit: String(
                      (balanceRaw as Record<string, unknown>).unit ?? ""
                    ),
                    type: String(
                      (balanceRaw as Record<string, unknown>).type ?? ""
                    ),
                  }
                : null,
            monthlyUsed:
              monthlyUsedRaw && typeof monthlyUsedRaw === "object"
                ? {
                    currency: String(
                      (monthlyUsedRaw as Record<string, unknown>).currency ?? ""
                    ),
                    priceInCents: String(
                      (monthlyUsedRaw as Record<string, unknown>)
                        .priceInCents ?? ""
                    ),
                  }
                : null,
            status: String(boosterRecord.status ?? ""),
          };
        })()
      : null;

  const parallelRaw = data?.parallel;
  const parallel =
    parallelRaw && typeof parallelRaw === "object"
      ? {
          limit: String((parallelRaw as Record<string, unknown>).limit ?? ""),
        }
      : null;

  // Real API nests membership under user; fall back to top-level
  const membershipRaw = data?.user?.membership ?? data?.membership;
  const membership =
    membershipRaw && typeof membershipRaw === "object"
      ? {
          level: String((membershipRaw as Record<string, unknown>).level ?? ""),
        }
      : null;

  return {
    provider: "moonshot",
    fiveHour,
    weekly,
    monthly,
    boosterWallet,
    parallel,
    membership,
  };
}

export async function testMoonshotConnection(
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchWithTimeout(
      "https://api.moonshot.cn/v1/users/me/balance",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      DEFAULT_TIMEOUT
    );
    if (response.ok) return { ok: true, message: "连接成功" };
    return { ok: false, message: `API 返回 ${response.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchMoonshotBalance(
  apiKey: string
): Promise<BalanceResult> {
  const response = await fetchWithTimeout(
    "https://api.moonshot.cn/v1/users/me/balance",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Moonshot API error:", response.status, errorText);
    throw new Error(`Moonshot API returned ${response.status}`);
  }

  const data = await response.json();

  const availableBalance = data?.data?.available_balance;
  const voucherBalance = data?.data?.voucher_balance;
  const cashBalance = data?.data?.cash_balance;

  if (typeof availableBalance !== "number") {
    throw new Error("Unexpected Moonshot API response format");
  }

  return {
    provider: "moonshot",
    isAvailable: data.status && availableBalance > 0,
    balanceInfos: [
      {
        currency: "CNY",
        totalBalance: availableBalance.toFixed(2),
        grantedBalance: (typeof voucherBalance === "number"
          ? voucherBalance
          : 0
        ).toFixed(2),
        toppedUpBalance: (typeof cashBalance === "number"
          ? cashBalance
          : 0
        ).toFixed(2),
      },
    ],
  };
}
