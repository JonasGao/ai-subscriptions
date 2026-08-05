/**
 * Feishu helper functions for retrieving chat_id and open_id.
 *
 * This module provides utilities to:
 * - List chats the bot is a member of (for chat_id selection)
 * - Look up users by phone number (for open_id retrieval)
 * - Translate Feishu error codes to human-readable messages (re-exported
 *   from feishu-errors.ts for backward compatibility)
 *
 * Reuses token cache and fetch seams from feishu-app.ts.
 *
 * The canonical scope list lives in feishu-permissions.ts; the error
 * translator (feishu-errors.ts) consumes it so error hints stay in sync
 * with the UI checklist.
 */
import { getTenantToken, fetchFn } from "./feishu-app";

// Re-export error translation from feishu-errors.ts so existing imports
// from this module keep working (tests, callers) without creating a
// feishu-app <-> feishu-helpers cycle.
export { translateFeishuError, throwFeishuError } from "./feishu-errors";
import { throwFeishuError } from "./feishu-errors";

// ============ Shared request helper ============

/**
 * Parses a Feishu API response body, extracting the standard {code, msg, data} envelope.
 * Throws a translated error if the response indicates failure.
 */
async function parseFeishuResponse<T>(
  response: Response,
  context: string
): Promise<T> {
  const bodyText = await response.text().catch(() => "");
  let bodyJson: {
    code?: number;
    msg?: string;
    data?: T;
  } | null = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }

  if (!response.ok) {
    const code = bodyJson?.code ?? 0;
    const msg = bodyJson?.msg ?? `HTTP ${response.status}`;
    throwFeishuError(code, msg, context);
  }

  if (bodyJson?.code !== undefined && bodyJson.code !== 0) {
    throwFeishuError(bodyJson.code, bodyJson.msg, context);
  }

  return bodyJson?.data as T;
}

// ============ Chat list ============

export interface FeishuChat {
  chat_id: string;
  name: string;
  avatar?: string;
  description?: string;
  owner_id?: string;
  chat_type?: string;
}

export interface FeishuChatListResult {
  items: FeishuChat[];
  has_more: boolean;
  page_token?: string;
}

/**
 * Lists chats the bot is a member of.
 *
 * @param appId - Feishu app ID
 * @param appSecret - Feishu app secret
 * @param opts - Optional pagination parameters
 * @returns Paginated list of chats
 *
 * Required scope: see `FEISHU_PERMISSIONS` in feishu-permissions.ts
 * (currently `im:chat:readonly`).
 */
export async function listFeishuChats(
  appId: string,
  appSecret: string,
  opts: { page_size?: number; page_token?: string } = {}
): Promise<FeishuChatListResult> {
  const token = await getTenantToken(appId, appSecret);
  const pageSize = opts.page_size ?? 50;
  const url = new URL("https://open.feishu.cn/open-apis/im/v1/chats");
  url.searchParams.set("page_size", String(pageSize));
  if (opts.page_token) {
    url.searchParams.set("page_token", opts.page_token);
  }

  const response = await fetchFn(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await parseFeishuResponse<{
    items?: FeishuChat[];
    has_more?: boolean;
    page_token?: string;
  }>(response, "获取群列表失败");

  return {
    items: data?.items ?? [],
    has_more: data?.has_more ?? false,
    page_token: data?.page_token,
  };
}

// ============ User lookup by phone ============

export interface FeishuUser {
  user_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
  mobile?: string;
  email?: string;
}

export interface FeishuUserLookupResult {
  user_list: FeishuUser[];
}

/**
 * Looks up users by phone number.
 *
 * @param appId - Feishu app ID
 * @param appSecret - Feishu app secret
 * @param mobiles - Array of phone numbers in international format (e.g., ["+8613800138000"])
 * @returns List of matched users with open_id
 *
 * Required scope: see `FEISHU_PERMISSIONS` in feishu-permissions.ts
 * (currently `contact:user.id:readonly`).
 */
export async function lookupFeishuUserByPhone(
  appId: string,
  appSecret: string,
  mobiles: string[]
): Promise<FeishuUserLookupResult> {
  if (mobiles.length === 0) {
    throw new Error("手机号列表不能为空");
  }

  const token = await getTenantToken(appId, appSecret);
  const url = "https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id";

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mobiles }),
  });

  const data = await parseFeishuResponse<{
    user_list?: FeishuUser[];
  }>(response, "手机号反查失败");

  return {
    user_list: data?.user_list ?? [],
  };
}
