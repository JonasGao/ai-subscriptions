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
import type { NotificationChannel } from "@/lib/types";
import type { NotificationEvent } from "./payload";
import { buildEventMarkdown, buildFeishuCard } from "./payload";

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
  tokenCache.clear();
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

/**
 * Token cache keyed by appId. Multiple feishu-app channels with different
 * credentials must not share a single cached token — using a Map prevents
 * one channel's refresh from invalidating another's cached token.
 */
const tokenCache = new Map<string, CachedToken>();

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
  const cached = tokenCache.get(appId);
  if (!forceRefresh && cached && cached.expiresAtMs > nowMs) {
    return cached.token;
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
  const newToken: CachedToken = {
    token: data.tenant_access_token,
    expiresAtMs: nowMs + expireSeconds * 1000 - EXPIRY_BUFFER_MS,
  };
  tokenCache.set(appId, newToken);
  return newToken.token;
}

/**
 * Clears cached tokens. When called with an appId, clears only that app's
 * token; otherwise clears all cached tokens (useful for test cleanup).
 */
export function clearTokenCache(appId?: string): void {
  if (appId) {
    tokenCache.delete(appId);
  } else {
    tokenCache.clear();
  }
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
  return JSON.stringify(buildFeishuCard(title, body));
}

// ============ Credentials helper ============

/**
 * Validated feishu-app credentials. All fields are guaranteed non-empty.
 */
export interface FeishuAppCredentials {
  appId: string;
  appSecret: string;
  receiveId: string;
  receiveIdType: string;
}

/**
 * Extracts and validates feishu-app credentials from a channel.
 * Returns the credentials object if all required fields are present and non-empty.
 * Throws an error if any required field is missing.
 *
 * Used by both dispatcher.ts and [id]/route.ts to avoid duplicating validation logic.
 */
export function feishuAppCredentials(
  channel: NotificationChannel
): FeishuAppCredentials {
  if (channel.type !== "feishu-app") {
    throw new Error(`Channel ${channel.id} is not a feishu-app channel`);
  }
  if (
    !channel.appId ||
    !channel.appSecret ||
    !channel.receiveId ||
    !channel.receiveIdType
  ) {
    throw new Error(
      `feishu-app channel ${channel.id} is missing required fields (appId/appSecret/receiveId/receiveIdType)`
    );
  }
  return {
    appId: channel.appId,
    appSecret: channel.appSecret,
    receiveId: channel.receiveId,
    receiveIdType: channel.receiveIdType,
  };
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
  creds: FeishuAppCredentials
): Promise<void> {
  const content = buildFeishuAppCard(event);
  await sendWithRetry(creds, content, /* forceRefresh */ false);
}

async function sendWithRetry(
  creds: FeishuAppCredentials,
  content: string,
  forceRefresh: boolean
): Promise<void> {
  const token = await getTenantToken(
    creds.appId,
    creds.appSecret,
    forceRefresh
  );
  const url = `${SEND_URL_BASE}?receive_id_type=${creds.receiveIdType}`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: creds.receiveId,
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

  if (tokenInvalid && !forceRefresh) {
    // Force-refresh the token and retry once.
    await sendWithRetry(creds, content, /* forceRefresh */ true);
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
