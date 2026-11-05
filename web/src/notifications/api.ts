// Notification API client (#44). Error bodies come straight from the server,
// which ports the old handlers' {error} strings verbatim.

import type { ChannelPayload, ChannelView, NotificationsConfig } from "./types";

export class NotificationApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "NotificationApiError";
  }
}

async function parseError(res: Response): Promise<NotificationApiError> {
  let message = `请求失败（${res.status}）`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON error bodies keep the status-based message.
  }
  return new NotificationApiError(message, res.status);
}

async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function fetchNotificationsConfig(): Promise<NotificationsConfig> {
  return requestJSON<NotificationsConfig>("/api/notifications");
}

export function createChannel(payload: ChannelPayload): Promise<ChannelView> {
  return requestJSON<ChannelView>("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateChannel(
  id: string,
  payload: ChannelPayload
): Promise<ChannelView> {
  return requestJSON<ChannelView>(`/api/notifications/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteChannel(id: string): Promise<{ success: boolean }> {
  return requestJSON<{ success: boolean }>(`/api/notifications/${id}`, {
    method: "DELETE",
  });
}

export function toggleChannel(id: string): Promise<ChannelView> {
  return requestJSON<ChannelView>(`/api/notifications/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle" }),
  });
}

/**
 * testChannel posts {"action":"test"}. The server answers 502 with
 * {success:false,error} when the send fails, so read the body before deciding
 * which error to surface.
 */
export async function testChannel(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/notifications/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "test" }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
  };
  if (!res.ok || data.success === false) {
    throw new NotificationApiError(
      data.error || `HTTP ${res.status}`,
      res.status
    );
  }
  return { success: true };
}

export function updateDefaultThreshold(
  value: number
): Promise<{ defaultLowBalanceThreshold: number }> {
  return requestJSON<{ defaultLowBalanceThreshold: number }>(
    "/api/notifications",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultLowBalanceThreshold: value }),
    }
  );
}

// ---------- Feishu app-bot helpers ----------

export interface FeishuChat {
  chat_id: string;
  name: string;
  avatar?: string;
  description?: string;
  owner_id?: string;
  chat_type?: string;
}

export interface FeishuChatList {
  items: FeishuChat[];
  has_more: boolean;
  page_token?: string;
}

export interface FeishuUser {
  user_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
  mobile?: string;
  email?: string;
}

export interface FeishuUserLookup {
  user_list: FeishuUser[];
}

export interface FeishuHelperBody {
  appId?: string;
  appSecret?: string;
  channelId?: string;
  page_token?: string;
  mobiles?: string[];
  emails?: string[];
  ttl_seconds?: number;
}

export function listFeishuChats(
  body: FeishuHelperBody
): Promise<FeishuChatList> {
  return requestJSON<FeishuChatList>("/api/notifications/feishu-app/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function lookupFeishuUsers(
  body: FeishuHelperBody
): Promise<FeishuUserLookup> {
  return requestJSON<FeishuUserLookup>(
    "/api/notifications/feishu-app/lookup-user",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export interface FeishuListenerStatus {
  appId: string;
  listenId: string;
  startedAt: string;
  messageCount: number;
  stopped: boolean;
  stopReason?: "manual" | "timeout" | "error";
  ttlSeconds: number;
}

export interface FeishuReceivedMessage {
  sender: {
    open_id: string;
    user_id?: string;
    union_id?: string;
    name?: string;
  };
  message: {
    message_id: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    create_time?: string;
  };
  receivedAt: string;
}

export function startFeishuListen(
  body: FeishuHelperBody
): Promise<FeishuListenerStatus> {
  return requestJSON<FeishuListenerStatus>(
    "/api/notifications/feishu-app/listen",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function pollFeishuListen(listenId: string): Promise<{
  status: FeishuListenerStatus;
  messages: FeishuReceivedMessage[];
}> {
  return requestJSON(
    `/api/notifications/feishu-app/listen?listenId=${encodeURIComponent(
      listenId
    )}`
  );
}

export function stopFeishuListen(
  listenId: string
): Promise<{ success: boolean }> {
  return requestJSON(
    `/api/notifications/feishu-app/listen?listenId=${encodeURIComponent(
      listenId
    )}`,
    { method: "DELETE" }
  );
}
