import {
  UsageResult,
  UsageWindow,
  UsageLimitWindow,
  BalanceResult,
} from "@/lib/types";

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

function normalizeUsageWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const limit = record.limit;
  const used = record.used;
  const remaining = record.remaining;
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
    TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Moonshot usage API error:", response.status, errorText);
    throw new Error(`Moonshot usage API returned ${response.status}`);
  }

  const data = await response.json();

  const usage = normalizeUsageWindow(data?.usage);

  const limits: UsageLimitWindow[] = Array.isArray(data?.limits)
    ? (data.limits as unknown[])
        .map((item) => {
          const record = item as Record<string, unknown>;
          const windowRaw = record.window;
          const detail = normalizeUsageWindow(record.detail);
          if (!windowRaw || typeof windowRaw !== "object" || !detail)
            return null;
          const windowRecord = windowRaw as Record<string, unknown>;
          return {
            window: {
              duration: Number(windowRecord.duration) || 0,
              timeUnit: String(windowRecord.timeUnit ?? ""),
            },
            detail,
          };
        })
        .filter((item): item is UsageLimitWindow => item !== null)
    : [];

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

  const membershipRaw = data?.membership;
  const membership =
    membershipRaw && typeof membershipRaw === "object"
      ? {
          level: String((membershipRaw as Record<string, unknown>).level ?? ""),
        }
      : null;

  return {
    provider: "moonshot",
    usage,
    limits,
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
      TIMEOUT
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
    TIMEOUT
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
