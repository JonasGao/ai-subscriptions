/**
 * Feishu helper functions for retrieving chat_id and open_id.
 *
 * This module provides utilities to:
 * - List chats the bot is a member of (for chat_id selection)
 * - Look up users by phone number (for open_id retrieval)
 * - Translate Feishu error codes to human-readable messages
 *
 * Reuses token cache and fetch seams from feishu-app.ts.
 */
import { getTenantToken, fetchFn } from "./feishu-app";

// ============ Error translation ============

/**
 * Maps Feishu error codes to human-readable messages with required scopes.
 * Returns null if the error code is not recognized (caller should fall back to msg).
 */
export function translateFeishuError(
  code: number,
  msg?: string
): string | null {
  const errorMap: Record<number, string> = {
    // Auth errors
    99991663: " tenant_access_token 无效或已过期,请检查 App ID 和 App Secret",
    99991664: "tenant_access_token 已过期,请刷新",
    99991665: "tenant_access_token 无效",
    99991668: "app_access_token 无效",

    // Permission errors
    99991400: "权限不足,请在飞书开放平台为应用开通相应权限",

    // Chat list specific
    1254043: "获取群列表失败:需要开通权限 im:chat:readonly 或 im:chat",
    1254045: "机器人不在任何群中,请先将机器人添加到群聊",

    // Contact specific
    1254003: "手机号反查失败:需要开通权限 contact:user.id:readonly",
    1254004: "手机号格式不正确,请使用国际区号格式(如 +8613800138000)",
    1254005: "未找到匹配的用户,请检查手机号是否正确",

    // General API errors
    1254000: "API 调用失败,请检查请求参数",
    1254001: "API 调用频率超限,请稍后重试",
  };

  return errorMap[code] ?? null;
}

/**
 * Throws a human-readable error for a Feishu API failure.
 * Combines the translated message (if available) with the original msg.
 */
export function throwFeishuError(
  code: number,
  msg?: string,
  context?: string
): never {
  const translated = translateFeishuError(code, msg);
  const prefix = context ? `${context}: ` : "";
  const fullMsg = translated
    ? `${prefix}${translated}${msg ? ` (原始错误: ${msg})` : ""}`
    : `${prefix}飞书 API 错误: code=${code}${msg ? `, msg=${msg}` : ""}`;
  throw new Error(fullMsg);
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
 * Required scope: im:chat:readonly or im:chat
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

  const bodyText = await response.text().catch(() => "");
  let bodyJson: {
    code?: number;
    msg?: string;
    data?: {
      items?: FeishuChat[];
      has_more?: boolean;
      page_token?: string;
    };
  } | null = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }

  if (!response.ok) {
    const code = bodyJson?.code ?? 0;
    const msg = bodyJson?.msg ?? `HTTP ${response.status}`;
    throwFeishuError(code, msg, "获取群列表失败");
  }

  if (bodyJson && bodyJson.code !== 0) {
    throwFeishuError(bodyJson.code, bodyJson.msg, "获取群列表失败");
  }

  return {
    items: bodyJson?.data?.items ?? [],
    has_more: bodyJson?.data?.has_more ?? false,
    page_token: bodyJson?.data?.page_token,
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
 * Required scope: contact:user.id:readonly
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

  const bodyText = await response.text().catch(() => "");
  let bodyJson: {
    code?: number;
    msg?: string;
    data?: {
      user_list?: FeishuUser[];
    };
  } | null = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }

  if (!response.ok) {
    const code = bodyJson?.code ?? 0;
    const msg = bodyJson?.msg ?? `HTTP ${response.status}`;
    throwFeishuError(code, msg, "手机号反查失败");
  }

  if (bodyJson && bodyJson.code !== 0) {
    throwFeishuError(bodyJson.code, bodyJson.msg, "手机号反查失败");
  }

  return {
    user_list: bodyJson?.data?.user_list ?? [],
  };
}
