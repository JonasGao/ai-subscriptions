/**
 * Feishu helper functions for retrieving chat_id and open_id.
 *
 * This module provides utilities to:
 * - List chats the bot is a member of (for chat_id selection)
 * - Look up users by phone number (for open_id retrieval)
 * - Translate Feishu error codes to human-readable messages
 *
 * Reuses token cache and fetch seams from feishu-app.ts.
 *
 * The canonical scope list lives in feishu-permissions.ts; this module
 * imports it so error translations stay in sync with the UI checklist.
 */
import { getTenantToken, fetchFn } from "./feishu-app";
import {
  FEISHU_PERMISSIONS,
  allScopeNames,
  findPermissionByScope,
} from "./feishu-permissions";

// ============ Error translation ============

/**
 * Maps Feishu error codes to human-readable messages.
 * Only includes codes verified against official Feishu documentation
 * (https://open.feishu.cn/document/server-docs/getting-started/server-error-codes).
 *
 * For unknown codes, falls back to the raw msg from the API response.
 *
 * Permission-related messages reference the centralized scope list in
 * feishu-permissions.ts so UI and error hints never drift apart.
 */
export function translateFeishuError(
  code: number,
  msg?: string
): string | null {
  const errorMap: Record<number, string> = {
    // Token errors (official: 99991660-99991668 series)
    99991663: "app_access_token 无效或已过期,请检查 App ID 和 App Secret",
    99991664: "tenant_access_token 无效或已过期,请重新获取",
    99991665: "tenant_access_token 格式错误或权限不足",
    99991668: "tenant_access_token 已过期,请刷新",

    // Permission errors (official)
    99991400: `权限不足,请在飞书开放平台为应用开通相应权限(所需权限: ${allScopeNames()})`,
    99991672: parseScopeError(msg), // 动态解析 msg 中的权限名列表
  };

  return errorMap[code] ?? null;
}

/**
 * Parses scope error messages to extract missing permission names.
 * Feishu's 99991672 msg often contains the missing scope names.
 *
 * Recognized scopes are resolved against the centralized
 * FEISHU_PERMISSIONS list so the message points users at the right
 * feature. Unrecognized scopes are surfaced verbatim.
 */
function parseScopeError(msg?: string): string {
  const fallback = `权限不足,请在飞书开放平台为应用开通相应权限(所需权限: ${allScopeNames()})`;
  if (!msg) {
    return fallback;
  }
  // Try to extract scope names from msg (e.g., "missing scope: im:chat:readonly")
  // Scope names can contain letters, digits, colons, dots, underscores, commas, spaces
  const scopeMatch = msg.match(/scope[s]?:\s*([a-zA-Z0-9_:.,\s]+)/i);
  if (scopeMatch) {
    const rawScopes = scopeMatch[1]
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const resolved = rawScopes.map((s) => {
      const found = findPermissionByScope(s);
      return found ? `${s}(${found.name})` : s;
    });
    if (resolved.length > 0) {
      return `权限不足,需要开通以下权限: ${resolved.join(", ")}`;
    }
  }
  return `权限不足: ${msg}`;
}

/**
 * Throws a human-readable error for a Feishu API failure.
 * Combines the translated message (if available) with the original msg.
 * Falls back to guiding the user to check the raw msg for unknown codes.
 */
export function throwFeishuError(
  code: number,
  msg?: string,
  context?: string
): never {
  const translated = translateFeishuError(code, msg);
  const prefix = context ? `${context}: ` : "";
  let fullMsg: string;
  if (translated) {
    fullMsg = `${prefix}${translated}`;
    // For non-scope errors, append raw msg if different from translation
    if (code !== 99991672 && msg && !translated.includes(msg)) {
      fullMsg += ` (详情: ${msg})`;
    }
  } else {
    // Unknown code: guide user to check raw msg
    fullMsg = msg
      ? `${prefix}飞书 API 错误(code=${code}): ${msg}。请在飞书开放平台文档中查阅此错误码。`
      : `${prefix}飞书 API 错误: code=${code}。请在飞书开放平台文档中查阅此错误码。`;
  }
  throw new Error(fullMsg);
}

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
