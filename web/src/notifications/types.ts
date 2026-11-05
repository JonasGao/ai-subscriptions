// Notification channel types, ported from lib/types.ts and the old
// app/notifications/page.tsx view model (#44).

export type NotificationChannelType =
  "dingtalk" | "feishu" | "webhook" | "feishu-app";

export type FeishuReceiveIdType = "open_id" | "chat_id";

export interface SendResult {
  success: boolean;
  timestamp: string;
  error?: string;
}

/**
 * ChannelView is the sanitized channel the API returns: secrets are replaced
 * by hasSecret/hasAppSecret flags.
 */
export interface ChannelView {
  id: string;
  type: NotificationChannelType;
  name: string;
  url?: string;
  appId?: string;
  receiveId?: string;
  receiveIdType?: FeishuReceiveIdType;
  enabled: boolean;
  hasSecret: boolean;
  hasAppSecret: boolean;
  lastSendResult?: SendResult;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsConfig {
  channels: ChannelView[];
  defaultLowBalanceThreshold: number;
}

/** ChannelFormState mirrors the old dialog's local form state. */
export interface ChannelFormState {
  name: string;
  type: NotificationChannelType;
  url: string;
  secret: string;
  enabled: boolean;
  clearSecret: boolean;
  appId: string;
  appSecret: string;
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
  clearAppSecret: boolean;
}

/** ChannelPayload is the request body the dialog hands to the page. */
export interface ChannelPayload {
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  url?: string;
  secret?: string | null;
  appId?: string;
  appSecret?: string | null;
  receiveId?: string;
  receiveIdType?: FeishuReceiveIdType;
}

export const EMPTY_CHANNEL_FORM: ChannelFormState = {
  name: "",
  type: "dingtalk",
  url: "",
  secret: "",
  enabled: true,
  clearSecret: false,
  appId: "",
  appSecret: "",
  receiveId: "",
  receiveIdType: "open_id",
  clearAppSecret: false,
};

export const CHANNEL_TYPE_LABELS: Record<NotificationChannelType, string> = {
  dingtalk: "钉钉",
  feishu: "飞书",
  webhook: "Webhook",
  "feishu-app": "飞书应用",
};

/** isFeishuAppType narrows a channel type to the app-bot flavor. */
export function isFeishuAppType(type: NotificationChannelType): boolean {
  return type === "feishu-app";
}
