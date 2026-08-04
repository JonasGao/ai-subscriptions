import { NotificationChannel, Subscription } from "@/lib/types";
import { computeDingtalkSign } from "./signing";

/**
 * Event shapes the notification system can emit.
 */
export type NotificationEvent = {
  kind: "low-balance";
  subscription: Subscription;
  balance: number;
  threshold: number;
  triggeredAt: string;
};

// ============ Common markdown builder ============

/**
 * Builds the natural-language title and body for a low-balance alert.
 *
 * When the channel has no signing secret we assume keyword security mode and
 * weave the keyword "AI订阅" into the title so the message body contains it
 * organically. Channels with a configured secret do not include the keyword.
 */
export function buildLowBalanceMarkdown(
  sub: Subscription,
  balance: number,
  threshold: number,
  includeKeyword: boolean
): { title: string; body: string } {
  const title = includeKeyword
    ? `【AI订阅】🪫 ${sub.name} 余额不足提醒`
    : `🪫 ${sub.name} 余额不足`;
  const lines = [
    `- **订阅**: ${sub.name}`,
    `- **提供商**: ${sub.provider}`,
    `- **当前余额**: ${balance}`,
    `- **阈值**: ${threshold}`,
    `- **时间**: ${new Date().toLocaleString("zh-CN")}`,
  ];
  return { title, body: lines.join("\n") };
}

// ============ DingTalk ============

export interface DingtalkPayload {
  msgtype: "markdown";
  markdown: {
    title: string;
    text: string;
  };
}

export function buildDingtalkPayload(
  event: NotificationEvent,
  includeKeyword: boolean
): DingtalkPayload {
  const { title, body } = buildLowBalanceMarkdown(
    event.subscription,
    event.balance,
    event.threshold,
    includeKeyword
  );
  return {
    msgtype: "markdown",
    markdown: { title, text: body },
  };
}

export function buildDingtalkUrl(channel: NotificationChannel): string {
  if (!channel.secret) return channel.url;
  const signResult = computeDingtalkSign(channel.secret, Date.now());
  if (!signResult) return channel.url;
  const separator = channel.url.includes("?") ? "&" : "?";
  return `${channel.url}${separator}timestamp=${signResult.timestamp}&sign=${signResult.sign}`;
}

// ============ Generic webhook ============

export interface WebhookPayload {
  event: "low-balance";
  subscription: {
    id: string;
    name: string;
    provider: string;
    subscriptionType: string;
  };
  lowBalance: { balance: number; threshold: number };
  triggeredAt: string;
}

export function buildWebhookPayload(event: NotificationEvent): WebhookPayload {
  return {
    event: "low-balance",
    subscription: {
      id: event.subscription.id,
      name: event.subscription.name,
      provider: event.subscription.provider,
      subscriptionType: event.subscription.subscriptionType,
    },
    lowBalance: { balance: event.balance, threshold: event.threshold },
    triggeredAt: event.triggeredAt,
  };
}

// ============ Dispatch unit ============

export interface PreparedSend {
  channel: NotificationChannel;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Builds a channel-specific (url, body, headers) triple for the event.
 * Only DingTalk and webhook are implemented here; Feishu and other channels
 * will be added in follow-up tickets.
 *
 * Throws when the channel type is not implemented or the channel is disabled.
 */
export function prepareSend(
  channel: NotificationChannel,
  event: NotificationEvent
): PreparedSend {
  if (!channel.enabled) {
    throw new Error(`Cannot prepare send for disabled channel ${channel.id}`);
  }
  const includeKeyword = !channel.secret;
  switch (channel.type) {
    case "dingtalk": {
      const payload = buildDingtalkPayload(event, includeKeyword);
      const body = JSON.stringify(payload);
      return {
        channel,
        url: buildDingtalkUrl(channel),
        body,
        headers: { "Content-Type": "application/json" },
      };
    }
    case "webhook": {
      const payload = buildWebhookPayload(event);
      const body = JSON.stringify(payload);
      return {
        channel,
        url: channel.url,
        body,
        headers: { "Content-Type": "application/json" },
      };
    }
    case "feishu": {
      // Feishu support deferred to follow-up ticket (#4).
      throw new Error(`Channel type '${channel.type}' is not yet implemented`);
    }
  }
}

// ============ Shared HTTP sender ============

/**
 * Default HTTP sender used by both the dispatcher and the API test-send
 * endpoint. Exported so tests and callers share one implementation.
 */
export async function httpSender(send: PreparedSend): Promise<void> {
  const response = await fetch(send.url, {
    method: "POST",
    headers: send.headers,
    body: typeof send.body === "string" ? send.body : JSON.stringify(send.body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`
    );
  }
}
