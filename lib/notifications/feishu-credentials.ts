/**
 * Credential resolution helpers for feishu-app API routes.
 *
 * The front-end can either:
 * - Provide appId + appSecret directly (new channel or explicit update)
 * - Provide an existing channelId and rely on hasSecret (editing an existing channel)
 *
 * This module resolves whichever form is provided into concrete credentials.
 */
import { getChannelById } from "./storage";

export interface ResolvedCredentials {
  appId: string;
  appSecret: string;
}

/**
 * Resolves feishu-app credentials from the request body.
 *
 * Resolution order:
 * 1. If `appId` and `appSecret` are both non-empty strings in the body → use them
 * 2. If `channelId` is provided and the stored channel has appSecret (hasSecret=true)
 *    and body doesn't include a new appSecret → use stored credentials
 * 3. If `channelId` is provided, body includes a new appId, but no appSecret →
 *    use the stored appSecret with the new appId (partial update case)
 * 4. Otherwise → throws an error
 *
 * @param body - Request body
 * @returns Resolved credentials or throws
 */
export function resolveFeishuCredentials(
  body: Record<string, unknown>
): ResolvedCredentials {
  // Case 1: Direct credentials in body
  const appIdFromBody = typeof body.appId === "string" ? body.appId.trim() : "";
  const appSecretFromBody =
    typeof body.appSecret === "string" ? body.appSecret.trim() : "";

  if (appIdFromBody && appSecretFromBody) {
    return { appId: appIdFromBody, appSecret: appSecretFromBody };
  }

  // Case 2/3: Use stored channel
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  if (!channelId) {
    throw new Error(
      "请提供 appId 和 appSecret,或提供已保存渠道的 channelId 以使用已存储的凭据"
    );
  }

  const channel = getChannelById(channelId);
  if (!channel) {
    throw new Error(`渠道 ${channelId} 不存在`);
  }

  if (channel.type !== "feishu-app") {
    throw new Error(`渠道 ${channelId} 不是 feishu-app 类型`);
  }

  const storedAppId = channel.appId ?? "";
  const storedAppSecret = channel.appSecret ?? "";

  if (!storedAppSecret) {
    throw new Error(`渠道 ${channelId} 没有已存储的 appSecret,请手动填写`);
  }

  // Use body appId if provided, else fall back to stored
  const resolvedAppId = appIdFromBody || storedAppId;
  if (!resolvedAppId) {
    throw new Error("缺少 appId");
  }

  return { appId: resolvedAppId, appSecret: storedAppSecret };
}
