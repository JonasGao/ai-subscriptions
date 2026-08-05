/**
 * Feishu error translation.
 *
 * Separated from feishu-helpers.ts so feishu-app.ts can translate send-path
 * errors (e.g. missing im:message:send_as_bot) without creating a circular
 * import: feishu-app <-> feishu-helpers.
 *
 * This module depends only on feishu-permissions.ts (the canonical scope
 * registry), never on feishu-app.ts.
 */
import { allScopeNames, findPermissionByScope } from "./feishu-permissions";

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
 * Recognized scopes are resolved against the centralized permissions
 * registry (feishu-permissions.ts) so the message points users at the
 * right feature. Unrecognized scopes are surfaced verbatim.
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
