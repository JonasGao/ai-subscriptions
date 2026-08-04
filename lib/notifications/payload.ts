import { NotificationChannel, Subscription } from "@/lib/types";
import { computeDingtalkSign, computeFeishuSign } from "./signing";

// Keyword appended to message bodies when no signing secret is configured.
// DingTalk's "keyword" security mode requires the message text to contain
// at least one configured keyword; we assume the user configured "AI订阅".
export const NO_SECRET_KEYWORD = "AI订阅";

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
      kind: "reset-tick";
      subscription: Subscription;
      scheduleId: string;
      scheduleType: string;
      nextResetTime: string;
      triggeredAt: string;
    };

// ============ Common markdown builder ============

export function buildLowBalanceMarkdown(
  sub: Subscription,
  balance: number,
  threshold: number
): { title: string; body: string } {
  const title = `🪫 ${sub.name} 余额不足`;
  const body = [
    `- **订阅**: ${sub.name}`,
    `- **提供商**: ${sub.provider}`,
    `- **当前余额**: ${balance}`,
    `- **阈值**: ${threshold}`,
    `- **时间**: ${new Date().toLocaleString("zh-CN")}`,
    `- **关键词**: ${NO_SECRET_KEYWORD}`,
  ].join("\n");
  return { title, body };
}

export function buildResetTickMarkdown(
  sub: Subscription,
  scheduleType: string,
  nextResetTime: string
): { title: string; body: string } {
  const title = `🔄 ${sub.name} 额度已重置`;
  const body = [
    `- **订阅**: ${sub.name}`,
    `- **提供商**: ${sub.provider}`,
    `- **重置类型**: ${scheduleType}`,
    `- **下次重置**: ${new Date(nextResetTime).toLocaleString("zh-CN")}`,
    `- **时间**: ${new Date().toLocaleString("zh-CN")}`,
    `- **关键词**: ${NO_SECRET_KEYWORD}`,
  ].join("\n");
  return { title, body };
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
  event: NotificationEvent
): DingtalkPayload {
  const { title, body } =
    event.kind === "low-balance"
      ? buildLowBalanceMarkdown(
          event.subscription,
          event.balance,
          event.threshold
        )
      : buildResetTickMarkdown(
          event.subscription,
          event.scheduleType,
          event.nextResetTime
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

// ============ Feishu ============

export interface FeishuPayload {
  msg_type: "interactive";
  card: {
    header: { title: { tag: "plain_text"; content: string } };
    elements: Array<{ tag: "markdown"; content: string }>;
  };
}

export function buildFeishuPayload(event: NotificationEvent): FeishuPayload {
  const { title, body } =
    event.kind === "low-balance"
      ? buildLowBalanceMarkdown(
          event.subscription,
          event.balance,
          event.threshold
        )
      : buildResetTickMarkdown(
          event.subscription,
          event.scheduleType,
          event.nextResetTime
        );
  return {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: title } },
      elements: [{ tag: "markdown", content: body }],
    },
  };
}

export function buildFeishuUrl(channel: NotificationChannel): string {
  // Feishu v2 webhook signing is appended to the payload body, not the URL.
  return channel.url;
}

export function applyFeishuSign(
  payload: FeishuPayload,
  channel: NotificationChannel
): FeishuPayload {
  if (!channel.secret) return payload;
  const signResult = computeFeishuSign(
    channel.secret,
    Math.floor(Date.now() / 1000)
  );
  if (!signResult) return payload;
  return {
    ...payload,
    card: {
      ...payload.card,
      header: {
        ...payload.card.header,
        title: {
          ...payload.card.header.title,
          content: payload.card.header.title.content,
        },
      },
      // Feishu sign is injected via top-level `timestamp` + `sign` fields
      // on the card element set. We emit them here for completeness.
      elements: [
        {
          tag: "markdown",
          content: `_sign: ts=${signResult.timestamp}_\n\n${payload.card.elements[0]?.content ?? ""}`,
        },
        ...payload.card.elements.slice(1),
      ],
    },
  };
}

// ============ Generic webhook ============

export interface WebhookPayload {
  event: NotificationEvent["kind"];
  subscription: {
    id: string;
    name: string;
    provider: string;
    subscriptionType: string;
  };
  lowBalance?: { balance: number; threshold: number };
  resetTick?: {
    scheduleId: string;
    scheduleType: string;
    nextResetTime: string;
  };
  triggeredAt: string;
}

export function buildWebhookPayload(event: NotificationEvent): WebhookPayload {
  const base = {
    event: event.kind,
    subscription: {
      id: event.subscription.id,
      name: event.subscription.name,
      provider: event.subscription.provider,
      subscriptionType: event.subscription.subscriptionType,
    },
    triggeredAt: event.triggeredAt,
  };
  if (event.kind === "low-balance") {
    return {
      ...base,
      lowBalance: { balance: event.balance, threshold: event.threshold },
    };
  }
  return {
    ...base,
    resetTick: {
      scheduleId: event.scheduleId,
      scheduleType: event.scheduleType,
      nextResetTime: event.nextResetTime,
    },
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
 * Pure wrt. the event; only Date.now() introduces impurity for signing.
 */
export function prepareSend(
  channel: NotificationChannel,
  event: NotificationEvent
): PreparedSend {
  if (!channel.enabled) {
    throw new Error(`Cannot prepare send for disabled channel ${channel.id}`);
  }
  switch (channel.type) {
    case "dingtalk": {
      const payload = buildDingtalkPayload(event);
      const body = JSON.stringify(payload);
      return {
        channel,
        url: buildDingtalkUrl(channel),
        body,
        headers: { "Content-Type": "application/json" },
      };
    }
    case "feishu": {
      let payload = buildFeishuPayload(event);
      payload = applyFeishuSign(payload, channel);
      const body = JSON.stringify(payload);
      return {
        channel,
        url: buildFeishuUrl(channel),
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
  }
}
