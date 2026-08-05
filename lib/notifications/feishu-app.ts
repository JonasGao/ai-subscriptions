/**
 * Feishu App bot channel: tenant_access_token cache + message send.
 *
 * Token lifecycle:
 * - Feishu tokens expire in ~2h (7200s). We cache in module memory and
 *   treat them as expired 5 minutes early to avoid racing the server.
 * - On send, a 401 response or Feishu error code 99991663 means the token
 *   is invalid. We force-refresh once and retry.
 *
 * The module exposes `now()` and `fetchFn` seams so tests can inject
 * deterministic time and network calls. Production uses Date.now() and
 * global fetch.
 */
import type { NotificationEvent } from "./payload";
import { buildEventMarkdown } from "./payload";

// ============ Seams for testing ============

/** Injectable clock. Defaults to Date.now(). */
export let now: () => number = () => Date.now();

/** Injectable fetch. Defaults to global fetch. */
export let fetchFn: (url: string, init: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init);

export function setNow(fn: () => number): void {
  now = fn;
}

export function setFetchFn(fn: typeof fetchFn): void {
  fetchFn = fn;
}

/** Reset seams to production defaults. For test cleanup. */
export function resetSeams(): void {
  now = () => Date.now();
  fetchFn = (url, init) => fetch(url, init);
  // Also clear the cache so tests start fresh.
  cachedToken = null;
}

// ============ Token cache ============

const TOKEN_URL =
  "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

interface CachedToken {
  token: string;
  /** Absolute ms timestamp when this token is considered expired. */
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

/**
 * Returns a valid tenant_access_token, refreshing from cache or fetching a
 * new one. When `forceRefresh` is true, bypasses the cache (used after a
 * 401 / 99991663 error).
 */
export async function getTenantToken(
  appId: string,
  appSecret: string,
  forceRefresh: boolean = false
): Promise<string> {
  const nowMs = now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAtMs > nowMs) {
    return cachedToken.token;
  }

  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to fetch feishu tenant token: HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`
    );
  }

  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(
      `Failed to fetch feishu tenant token: code=${data.code} msg=${data.msg ?? "unknown"}`
    );
  }

  const expireSeconds = data.expire ?? 7200;
  cachedToken = {
    token: data.tenant_access_token,
    expiresAtMs: nowMs + expireSeconds * 1000 - EXPIRY_BUFFER_MS,
  };
  return cachedToken.token;
}

/** Clears the token cache. Exported for testing. */
export function clearTokenCache(): void {
  cachedToken = null;
}

// ============ Card payload ============

/**
 * Builds the feishu interactive card JSON string for a notification event.
 * Reuses the same markdown (title + field list) as the other channels.
 * feishu-app uses credential-based auth, so no keyword is woven in.
 */
export function buildFeishuAppCard(event: NotificationEvent): string {
  // feishu-app has no signing secret → keyword mode off
  const includeKeyword = false;
  const { title, body } = buildEventMarkdown(event, includeKeyword);

  const card = {
    header: {
      title: { tag: "plain_text", content: title },
    },
    elements: [{ tag: "markdown", content: body }],
  };
  return JSON.stringify(card);
}

// ============ Send with retry ============

const SEND_URL_BASE = "https://open.feishu.cn/open-apis/im/v1/messages";

/**
 * Sends an interactive card to a feishu receive_id. Handles token refresh
 * retry on 401 or error code 99991663.
 *
 * Returns void on success, throws on failure after retry is exhausted.
 */
export async function sendFeishuAppMessage(
  event: NotificationEvent,
  channel: {
    appId: string;
    appSecret: string;
    receiveId: string;
    receiveIdType: string;
  }
): Promise<void> {
  const content = buildFeishuAppCard(event);
  await sendWithRetry(channel, content, /* retryCount */ 0);
}

async function sendWithRetry(
  channel: {
    appId: string;
    appSecret: string;
    receiveId: string;
    receiveIdType: string;
  },
  content: string,
  retryCount: number
): Promise<void> {
  const token = await getTenantToken(channel.appId, channel.appSecret);
  const url = `${SEND_URL_BASE}?receive_id_type=${channel.receiveIdType}`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: channel.receiveId,
      msg_type: "interactive",
      content,
    }),
  });

  const bodyText = await response.text().catch(() => "");
  let bodyJson: { code?: number; msg?: string } | null = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }

  const tokenInvalid = response.status === 401 || bodyJson?.code === 99991663;

  if (tokenInvalid && retryCount === 0) {
    // Force-refresh the token and retry once.
    clearTokenCache();
    await sendWithRetry(channel, content, 1);
    return;
  }

  if (!response.ok) {
    throw new Error(
      `Feishu app send failed: HTTP ${response.status} ${response.statusText}${bodyText ? `: ${bodyText}` : ""}`
    );
  }

  if (bodyJson && bodyJson.code !== 0) {
    throw new Error(
      `Feishu app send failed: code=${bodyJson.code} msg=${bodyJson.msg ?? "unknown"}`
    );
  }
}
