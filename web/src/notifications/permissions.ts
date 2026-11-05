// Feishu permissions registry, ported verbatim from
// lib/notifications/feishu-permissions.ts (#44).

export interface FeishuPermission {
  scope: string;
  name: string;
  purpose: string;
  usedBy: string[];
}

export const FEISHU_PERMISSIONS: readonly FeishuPermission[] = [
  {
    scope: "im:message:send_as_bot",
    name: "以应用身份发送消息",
    purpose: "允许机器人向用户或群组发送消息( interactive 卡片 / 文本等)",
    usedBy: ["发送通知消息"],
  },
  {
    scope: "im:chat:readonly",
    name: "获取群组信息",
    purpose:
      "读取机器人所在的群列表,用于在设置页「从群列表选择」辅助填入 chat_id",
    usedBy: ["辅助获取 Receive ID - 群列表"],
  },
  {
    scope: "contact:user.id:readonly",
    name: "获取用户 userID",
    purpose:
      "通过手机号反查用户的 open_id,用于在设置页「手机号查询」辅助填入 receive_id",
    usedBy: ["辅助获取 Receive ID - 手机号反查"],
  },
  {
    scope: "im:message.p2p_msg:readonly",
    name: "读取用户发给机器人的单聊消息",
    purpose:
      "订阅 im.message.receive_v1 事件,接收用户与机器人的 1-on-1 聊天消息,用于在设置页「通过消息获取」辅助取得 open_id",
    usedBy: ["长连接监听 - 单聊消息"],
  },
  {
    scope: "im:message.group_at_msg:readonly",
    name: "读取群组中 @机器人的消息",
    purpose:
      "订阅 im.message.receive_v1 事件,接收群内 @机器人 的消息,用于在设置页「通过消息获取」辅助取得 open_id",
    usedBy: ["长连接监听 - 群聊 @消息"],
  },
] as const;

export const FEISHU_OPEN_PLATFORM_APP_URL =
  "https://open.feishu.cn/app/{appId}/permission" as const;

export const FEISHU_OPEN_PLATFORM_ROOT = "https://open.feishu.cn/app" as const;

export const FEISHU_WEBSOCKET_EVENT_HINT =
  "使用长连接模式时,还需在飞书开放平台后台「事件与回调 → 事件配置 → 接收方式」中选择「使用长连接接收事件」,并添加事件 im.message.receive_v1。" as const;

export const FEISHU_LISTEN_EVENT_KEY = "im.message.receive_v1" as const;

export function findPermissionByScope(
  scope: string
): FeishuPermission | undefined {
  return FEISHU_PERMISSIONS.find((permission) => permission.scope === scope);
}
