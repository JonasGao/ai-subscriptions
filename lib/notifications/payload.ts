import {
  NotificationChannel,
  Subscription,
  ResetScheduleType,
} from "@/lib/types";
import { computeDingtalkSign, computeFeishuSign } from "./signing";

/**
 * Event shapes the notification system can emit.
 */
export type NotificationEvent =
  | {
      kind: "low-balance";
      subscription: Subscription;
      balance: number;
      threshold: number;
      triggeredAt: string;
    }
  | {
      kind: "reset";
      subscription: Subscription;
      scheduleType: ResetScheduleType;
      nextResetTime: string;
      triggeredAt: string;
    };

// ============ Common markdown builder ============

/**
 * Shared markdown card assembly. Builds a keyword-aware title and a
 * subscription/provider/…/time field list. The timestamp footer is rendered
 * from the caller-supplied `triggeredAt` (the event's own timestamp) so the
 * message's visible time matches the event that produced it — never wall
 * clock at send time, which can differ under retries / batching.
 */
function buildMarkdownCard(
  sub: Subscription,
  emoji: string,
  longLabel: string,
  shortLabel: string,
  fields: string[],
  includeKeyword: boolean,
  triggeredAt: string
): { title: string; body: string } {
  const title = includeKeyword
    ? `【AI订阅】${emoji} ${sub.name} ${longLabel}`
    : `${emoji} ${sub.name} ${shortLabel}`;
  const lines = [
    `- **订阅**: ${sub.name}`,
    `- **提供商**: ${sub.provider}`,
    ...fields,
    `- **时间**: ${new Date(triggeredAt).toLocaleString("zh-CN")}`,
  ];
  return { title, body: lines.join("\n") };
}

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
  includeKeyword: boolean,
  triggeredAt: string
): { title: string; body: string } {
  return buildMarkdownCard(
    sub,
    "🪫",
    "余额不足提醒",
    "余额不足",
    [`- **当前余额**: ${balance}`, `- **阈值**: ${threshold}`],
    includeKeyword,
    triggeredAt
  );
}

/**
 * Human-readable label for a reset schedule type.
 */
export function formatScheduleType(type: ResetScheduleType): string {
  switch (type) {
    case "hourly":
      return "每小时";
    case "weekly":
      return "每周";
    case "monthly":
      return "每月";
  }
}

/**
 * Builds the markdown card for a quota-reset notification.
 */
export function buildResetMarkdown(
  sub: Subscription,
  scheduleType: ResetScheduleType,
  nextResetTime: string,
  includeKeyword: boolean,
  triggeredAt: string
): { title: string; body: string } {
  return buildMarkdownCard(
    sub,
    "🔄",
    "配额已重置",
    "配额已重置",
    [
      `- **重置计划**: ${formatScheduleType(scheduleType)}`,
      `- **下次重置**: ${new Date(nextResetTime).toLocaleString("zh-CN")}`,
    ],
    includeKeyword,
    triggeredAt
  );
}

/**
 * Builds the markdown (title + body) for any notification event. Single
 * source of truth for the event.kind dispatch used by both DingTalk and
 * Feishu — they render the same markdown, just in different envelope shapes.
 */
export function buildEventMarkdown(
  event: NotificationEvent,
  includeKeyword: boolean
): { title: string; body: string } {
  return event.kind === "low-balance"
    ? buildLowBalanceMarkdown(
        event.subscription,
        event.balance,
        event.threshold,
        includeKeyword,
        event.triggeredAt
      )
    : buildResetMarkdown(
        event.subscription,
        event.scheduleType,
        event.nextResetTime,
        includeKeyword,
        event.triggeredAt
      );
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
  const { title, body } = buildEventMarkdown(event, includeKeyword);
  return {
    msgtype: "markdown",
    markdown: { title, text: body },
  };
}

export function buildDingtalkUrl(channel: NotificationChannel): string {
  const baseUrl = channel.url ?? "";
  if (!channel.secret) return baseUrl;
  const signResult = computeDingtalkSign(channel.secret, Date.now());
  if (!signResult) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}timestamp=${signResult.timestamp}&sign=${signResult.sign}`;
}

// ============ Feishu (Lark) ============

/**
 * Feishu interactive-card payload. The card carries the same markdown
 * (title + field list) built for DingTalk, rendered through Feishu's native
 * `markdown` element so it gets proper formatting in the chat UI.
 *
 * When the channel has a signing secret, the body also carries top-level
 * `timestamp` and `sign` fields (Feishu's own signing scheme) — this is why
 * the builder takes the channel, not just the event.
 */
export interface FeishuPayload {
  msg_type: "interactive";
  card: {
    header: {
      title: { tag: "plain_text"; content: string };
    };
    elements: Array<{ tag: "markdown"; content: string }>;
  };
  // Feishu signing fields; only present when the channel has a secret.
  timestamp?: string;
  sign?: string;
}

export function buildFeishuPayload(
  event: NotificationEvent,
  channel: NotificationChannel
): FeishuPayload {
  const includeKeyword = !channel.secret;
  const { title, body } = buildEventMarkdown(event, includeKeyword);

  const payload: FeishuPayload = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: title },
      },
      elements: [{ tag: "markdown", content: body }],
    },
  };

  if (channel.secret) {
    const signResult = computeFeishuSign(
      channel.secret,
      Math.floor(Date.now() / 1000)
    );
    if (signResult) {
      payload.timestamp = signResult.timestamp;
      payload.sign = signResult.sign;
    }
  }
  return payload;
}

// ============ Generic webhook ============

/**
 * Structured JSON payload for the generic webhook channel. Intentionally
 * platform-agnostic: consumers parse the `event` discriminator to decide how
 * to render / route / store the notification.
 */
export interface WebhookPayload {
  event: "low-balance" | "reset";
  timestamp: string;
  subscription: {
    id: string;
    name: string;
    category: string;
    provider: string;
    subscriptionType: "recurring" | "one-time";
    price: number;
  };
  // Present only for `low-balance` events.
  balance?: number;
  threshold?: number;
  // Present only for `reset` events.
  scheduleType?: ResetScheduleType;
  nextResetTime?: string;
}

export function buildWebhookPayload(event: NotificationEvent): WebhookPayload {
  const sub = event.subscription;
  return {
    event: event.kind,
    timestamp: event.triggeredAt,
    subscription: {
      id: sub.id,
      name: sub.name,
      category: sub.category,
      provider: sub.provider,
      subscriptionType: sub.subscriptionType,
      price: sub.price,
    },
    // Event-specific fields: low-balance carries balance/threshold,
    // reset carries scheduleType/nextResetTime. Conditional spread lets
    // TypeScript narrow each branch against the WebhookPayload type
    // without a cast.
    ...(event.kind === "low-balance"
      ? { balance: event.balance, threshold: event.threshold }
      : {
          scheduleType: event.scheduleType,
          nextResetTime: event.nextResetTime,
        }),
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
 *
 * Throws when the channel is disabled. Throws for feishu-app channels: those
 * are handled by a dedicated sender (see dispatcher.ts).
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
    case "feishu": {
      const payload = buildFeishuPayload(event, channel);
      const body = JSON.stringify(payload);
      return {
        channel,
        url: channel.url ?? "",
        body,
        headers: { "Content-Type": "application/json" },
      };
    }
    case "webhook": {
      const payload = buildWebhookPayload(event);
      const body = JSON.stringify(payload);
      return {
        channel,
        url: channel.url ?? "",
        body,
        headers: { "Content-Type": "application/json" },
      };
    }
    case "feishu-app": {
      // feishu-app channels are dispatched via a dedicated sender that handles
      // token management. This path should never be reached in normal flow.
      throw new Error(
        `prepareSend does not support feishu-app channel ${channel.id}; use the feishu-app sender`
      );
    }
  }
}

// ============ Shared HTTP sender ============

/**
 * Default HTTP sender used by the notification dispatcher.
 * Exported so tests and callers share one implementation.
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
