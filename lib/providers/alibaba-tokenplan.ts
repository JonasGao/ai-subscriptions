import { createHmac, createHash, randomUUID } from "crypto";
import { UsageResult, UsageWindow } from "@/lib/types";
import { fetchWithTimeout, DEFAULT_TIMEOUT } from "./fetch-utils";

// ── ACS3 signing ─────────────────────────────────────────────────────────────

type AcsQueryParams = Record<string, string | string[] | undefined | number>;

export interface AcsSignConfig {
  accessKeyId: string;
  accessKeySecret: string;
  action: string;
  version: string;
  body: string;
  host: string;
  pathname: string;
  method?: string;
  queryString?: string;
  /** Override for the x-acs-date header (ISO 8601, no ms). Defaults to now. */
  dateISO?: string;
  /** Override for x-acs-signature-nonce. Defaults to a random UUID. */
  nonce?: string;
}

/**
 * Build ACS3 canonical query string.
 * Array values expand to `Key.1=v1&Key.2=v2` style; the result is
 * percent-encoded and sorted by key (RFC 3986).
 */
export function buildAcsCanonicalQuery(params: AcsQueryParams): string {
  const pairs: Array<[string, string | number | undefined]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const v = value[i];
        if (v !== "") pairs.push([`${key}.${i + 1}`, v]);
      }
    } else {
      pairs.push([key, value]);
    }
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs
    .map(
      ([key, value]) => `${encodeRFC3986(key)}=${encodeRFC3986(String(value))}`
    )
    .join("&");
}

/**
 * Sign an ACS3 (Alibaba Cloud) request. Returns headers including
 * `authorization` (ACS3-HMAC-SHA256), `x-acs-action`, `x-acs-version`,
 * `x-acs-date`, `x-acs-signature-nonce`, `x-acs-content-sha256`,
 * `content-type`, and `host`.
 */
export function signAcsRequest(cfg: AcsSignConfig): Record<string, string> {
  const method = cfg.method ?? "POST";
  const dateISO =
    cfg.dateISO ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = cfg.nonce ?? randomUUID();
  const hashedBody = sha256Hex(cfg.body);

  const headers: Record<string, string> = {
    host: cfg.host,
    "x-acs-action": cfg.action,
    "x-acs-version": cfg.version,
    "x-acs-date": dateISO,
    "x-acs-signature-nonce": nonce,
    "x-acs-content-sha256": hashedBody,
    "content-type": "application/json",
  };

  const signedHeaderKeys = Object.keys(headers)
    .filter(
      (k) => k === "host" || k === "content-type" || k.startsWith("x-acs-")
    )
    .sort();
  const canonicalHeaders =
    signedHeaderKeys.map((k) => `${k}:${headers[k]}`).join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");
  const queryString = cfg.queryString ?? "";

  const canonicalRequest = [
    method,
    cfg.pathname,
    queryString,
    canonicalHeaders,
    signedHeadersStr,
    hashedBody,
  ].join("\n");

  const algorithm = "ACS3-HMAC-SHA256";
  const hashedCanonical = sha256Hex(canonicalRequest);
  const stringToSign = `${algorithm}\n${hashedCanonical}`;
  const signature = hmacSHA256Hex(cfg.accessKeySecret, stringToSign);

  headers.authorization = `${algorithm} Credential=${cfg.accessKeyId},SignedHeaders=${signedHeadersStr},Signature=${signature}`;
  return headers;
}

// ── Token Plan handler ───────────────────────────────────────────────────────

const DEFAULT_HOST = "modelstudio.cn-beijing.aliyuncs.com";
const API_PATH = "/tokenplan/subscription/seat-detail";
const API_ACTION = "GetSubscriptionSeatDetails";
const API_VERSION = "2026-02-10";

interface TokenPlanSeatEquity {
  EquityType?: string;
  CycleInstanceId?: string;
  CycleStartTime?: number;
  CycleEndTime?: number;
  CycleTotalValue?: number;
  CycleSurplusValue?: number;
  CycleVersion?: number;
}

interface TokenPlanSeatDetail {
  InstanceCode?: string;
  EquityList?: TokenPlanSeatEquity[];
  EndTime?: number;
  SeatId?: string;
  SpecType?: string;
  StartTime?: number;
  AssignedStatus?: string;
  AccountId?: string;
  AccountName?: string;
  AccountEmail?: string;
  Status?: string;
}

interface SeatDetailsResponse {
  Success?: boolean;
  Code?: string;
  Message?: string;
  Data?: {
    Items?: TokenPlanSeatDetail[];
    Total?: number;
    PageNo?: number;
    PageSize?: number;
  };
}

export async function fetchTokenPlanUsage(
  credentials: Record<string, string>
): Promise<UsageResult> {
  const { ak, sk, workspaceId } = credentials;
  if (!ak || !sk) throw new Error("AK/SK not configured");
  if (!workspaceId) throw new Error("WorkspaceId not configured");

  const host = credentials.host || DEFAULT_HOST;
  const queryParams = {
    WorkspaceId: workspaceId,
    NamespaceId: "namespace-1",
  };
  const queryString = buildAcsCanonicalQuery(queryParams);

  const headers = signAcsRequest({
    accessKeyId: ak,
    accessKeySecret: sk,
    action: API_ACTION,
    version: API_VERSION,
    body: "",
    host,
    pathname: API_PATH,
    method: "GET",
    queryString,
  });

  const endpoint = `https://${host}${API_PATH}?${queryString}`;
  const response = await fetchWithTimeout(
    endpoint,
    { method: "GET", headers },
    DEFAULT_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("TokenPlan usage API error:", response.status, errorText);
    throw new Error(`TokenPlan usage API returned ${response.status}`);
  }

  const data = (await response.json()) as SeatDetailsResponse;

  if (!data.Success || !data.Data?.Items || data.Data.Items.length === 0) {
    throw new Error(
      `No active TokenPlan seats: ${data.Code ?? ""} ${data.Message ?? ""}`.trim()
    );
  }

  let fiveHour: UsageWindow | null = null;
  let weekly: UsageWindow | null = null;
  let monthly: UsageWindow | null = null;

  for (const seat of data.Data.Items) {
    if (!seat.EquityList) continue;
    for (const equity of seat.EquityList) {
      const w = toUsageWindow(equity);
      if (!w) continue;
      const cls = classifyCycle(equity);
      if (cls === "fiveHour") fiveHour = pickHigher(fiveHour, w);
      else if (cls === "weekly") weekly = pickHigher(weekly, w);
      else if (cls === "monthly") monthly = pickHigher(monthly, w);
    }
  }

  return {
    provider: "alibaba",
    fiveHour,
    weekly,
    monthly,
    boosterWallet: null,
    parallel: null,
    membership: null,
  };
}

export async function testTokenPlanConnection(
  credentials: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const { ak, sk, workspaceId } = credentials;
  if (!ak || !sk) return { ok: false, message: "AK/SK 未配置" };
  if (!workspaceId) return { ok: false, message: "Workspace ID 未配置" };

  try {
    const host = credentials.host || DEFAULT_HOST;
    const queryParams = {
      WorkspaceId: workspaceId,
      NamespaceId: "namespace-1",
      PageSize: 1,
    };
    const queryString = buildAcsCanonicalQuery(queryParams);

    const headers = signAcsRequest({
      accessKeyId: ak,
      accessKeySecret: sk,
      action: API_ACTION,
      version: API_VERSION,
      body: "",
      host,
      pathname: API_PATH,
      method: "GET",
      queryString,
    });

    const endpoint = `https://${host}${API_PATH}?${queryString}`;
    const response = await fetchWithTimeout(
      endpoint,
      { method: "GET", headers },
      DEFAULT_TIMEOUT
    );

    if (!response.ok) {
      return { ok: false, message: `API 返回 ${response.status}` };
    }

    const data = (await response.json()) as SeatDetailsResponse;
    if (!data.Success) {
      return { ok: false, message: data.Message ?? "API 返回失败" };
    }

    const total = data.Data?.Total ?? 0;
    if (total > 0) {
      return { ok: true, message: `已订阅 (${total} 个席位)` };
    }
    return { ok: false, message: "未检测到 Token Plan 订阅" };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toUsageWindow(equity: TokenPlanSeatEquity): UsageWindow | null {
  const limit = equity.CycleTotalValue;
  if (!limit || limit <= 0) return null;
  const remaining = equity.CycleSurplusValue ?? 0;
  const used = Math.max(0, limit - remaining);
  const resetTime = equity.CycleEndTime
    ? new Date(equity.CycleEndTime).toISOString()
    : null;
  return {
    used: String(used),
    limit: String(limit),
    remaining: String(remaining),
    resetTime,
  };
}

/**
 * Bucket an equity into fiveHour/weekly/monthly based on its cycle duration
 * computed from CycleStartTime/CycleEndTime.
 *   < 30h   → fiveHour (covers 5h rolling windows)
 *   < 240h  → weekly  (covers ~7-day cycles)
 *   else    → monthly (covers ~30-day cycles)
 * Falls back to fiveHour when timestamps are missing.
 */
function classifyCycle(
  equity: TokenPlanSeatEquity
): "fiveHour" | "weekly" | "monthly" {
  if (
    equity.CycleStartTime === undefined ||
    equity.CycleEndTime === undefined
  ) {
    return "fiveHour";
  }
  const durationMs = equity.CycleEndTime - equity.CycleStartTime;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "fiveHour";
  const hours = durationMs / (1000 * 60 * 60);
  if (hours < 30) return "fiveHour";
  if (hours < 240) return "weekly";
  return "monthly";
}

/** When multiple equities map to the same window slot, keep the one
 *  with the higher limit (primary subscription vs. add-on). */
function pickHigher(
  current: UsageWindow | null,
  candidate: UsageWindow
): UsageWindow {
  if (!current) return candidate;
  return Number(candidate.limit) > Number(current.limit) ? candidate : current;
}

function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacSHA256Hex(key: string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}
