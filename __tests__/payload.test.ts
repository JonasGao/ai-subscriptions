import { describe, it, expect, vi } from "vitest";
import type { NotificationChannel, Subscription } from "@/lib/types";
import {
  buildDingtalkPayload,
  buildDingtalkUrl,
  buildFeishuPayload,
  buildWebhookPayload,
  buildLowBalanceMarkdown,
  buildResetMarkdown,
  formatScheduleType,
  prepareSend,
  type NotificationEvent,
} from "@/lib/notifications/payload";

// buildDingtalkUrl calls Date.now() for signing; mock it for determinism.
vi.useFakeTimers();
vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Claude Pro",
    category: "AI助手",
    provider: "anthropic",
    subscriptionType: "one-time",
    price: 20,
    status: "active",
    balance: 5,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeChannel(
  overrides: Partial<NotificationChannel> = {}
): NotificationChannel {
  return {
    id: "ch-1",
    type: "dingtalk",
    name: "Test",
    url: "https://oapi.dingtalk.com/robot/send?access_token=abc",
    enabled: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const lowBalanceEvent: NotificationEvent = {
  kind: "low-balance",
  subscription: makeSub(),
  balance: 5,
  threshold: 10,
  triggeredAt: "2024-06-01T00:00:00Z",
};

describe("buildLowBalanceMarkdown", () => {
  it("weaves keyword into title when includeKeyword is true", () => {
    const { title, body } = buildLowBalanceMarkdown(makeSub(), 5, 10, true);
    expect(title).toContain("【AI订阅】");
    expect(title).toContain("Claude Pro");
    // Keyword lives in the title naturally; the body itself has no separate
    // keyword line.
    expect(body).not.toMatch(/\*\*关键词\*\*/);
  });

  it("omits keyword from title when includeKeyword is false", () => {
    const { title } = buildLowBalanceMarkdown(makeSub(), 5, 10, false);
    expect(title).not.toContain("AI订阅");
    expect(title).toContain("余额不足");
  });
});

describe("buildDingtalkPayload", () => {
  it("returns msgtype=markdown with title and body", () => {
    const payload = buildDingtalkPayload(lowBalanceEvent, false);
    expect(payload.msgtype).toBe("markdown");
    expect(payload.markdown.title).toContain("Claude Pro");
    expect(payload.markdown.text).toContain("5");
    expect(payload.markdown.text).toContain("10");
  });
});

describe("buildDingtalkUrl", () => {
  it("returns raw URL when no secret", () => {
    const ch = makeChannel();
    expect(buildDingtalkUrl(ch)).toBe(ch.url);
  });

  it("appends timestamp+sign query params when secret present", () => {
    const ch = makeChannel({ secret: "mysecret" });
    const url = buildDingtalkUrl(ch);
    expect(url).toContain("timestamp=");
    expect(url).toContain("sign=");
  });
});

describe("prepareSend", () => {
  it("throws for disabled channels", () => {
    const ch = makeChannel({ enabled: false });
    expect(() => prepareSend(ch, lowBalanceEvent)).toThrow();
  });

  it("includes keyword in DingTalk payload only when channel has no secret", () => {
    const chNoSecret = makeChannel({ id: "no-secret" });
    const chWithSecret = makeChannel({ id: "with-secret", secret: "s3cret" });
    const noSecretPrepared = prepareSend(chNoSecret, lowBalanceEvent);
    const withSecretPrepared = prepareSend(chWithSecret, lowBalanceEvent);
    const noSecretBody = JSON.parse(noSecretPrepared.body as string);
    const withSecretBody = JSON.parse(withSecretPrepared.body as string);
    expect(noSecretBody.markdown.title).toContain("AI订阅");
    expect(withSecretBody.markdown.title).not.toContain("AI订阅");
  });

  it("returns JSON body with Content-Type header", () => {
    const ch = makeChannel();
    const prepared = prepareSend(ch, lowBalanceEvent);
    expect(prepared.headers["Content-Type"]).toBe("application/json");
    expect(typeof prepared.body).toBe("string");
    JSON.parse(prepared.body as string);
  });

  it("prepares a Feishu interactive-card payload with JSON content-type", () => {
    const ch = makeChannel({ id: "feishu-1", type: "feishu" });
    const prepared = prepareSend(ch, lowBalanceEvent);
    expect(prepared.url).toBe(ch.url);
    expect(prepared.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(prepared.body as string);
    expect(body.msg_type).toBe("interactive");
    expect(body.card.header.title.content).toContain("Claude Pro");
    expect(body.card.elements[0].tag).toBe("markdown");
    expect(body.card.elements[0].content).toContain("5");
    // No secret -> no timestamp/sign in body, but keyword present in title.
    expect(body.timestamp).toBeUndefined();
    expect(body.sign).toBeUndefined();
    expect(body.card.header.title.content).toContain("AI订阅");
  });

  it("prepares a Feishu payload with timestamp+sign when secret present", () => {
    const ch = makeChannel({
      id: "feishu-signed",
      type: "feishu",
      secret: "test-feishu-secret",
    });
    const prepared = prepareSend(ch, lowBalanceEvent);
    const body = JSON.parse(prepared.body as string);
    expect(body.msg_type).toBe("interactive");
    // Signed -> timestamp and sign are present.
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.sign).toBe("string");
    expect(body.sign.length).toBeGreaterThan(0);
    // Signed -> no keyword in title.
    expect(body.card.header.title.content).not.toContain("AI订阅");
  });

  it("prepares a webhook JSON payload with event metadata", () => {
    const ch = makeChannel({ id: "wh-1", type: "webhook" });
    const prepared = prepareSend(ch, lowBalanceEvent);
    expect(prepared.url).toBe(ch.url);
    expect(prepared.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(prepared.body as string);
    expect(body.event).toBe("low-balance");
    expect(body.subscription.id).toBe("sub-1");
    expect(body.subscription.name).toBe("Claude Pro");
    expect(body.balance).toBe(5);
    expect(body.threshold).toBe(10);
    expect(body.timestamp).toBe("2024-06-01T00:00:00Z");
  });
});

describe("formatScheduleType", () => {
  it("maps hourly/weekly/monthly to Chinese labels", () => {
    expect(formatScheduleType("hourly")).toBe("每小时");
    expect(formatScheduleType("weekly")).toBe("每周");
    expect(formatScheduleType("monthly")).toBe("每月");
  });
});

describe("buildResetMarkdown", () => {
  const sub = makeSub({ name: "OpenAI Plus", provider: "openai" });

  it("includes subscription name, schedule type, and next reset time", () => {
    const { title, body } = buildResetMarkdown(
      sub,
      "monthly",
      "2024-07-01T00:00:00Z",
      false
    );
    expect(title).toContain("OpenAI Plus");
    expect(title).toContain("配额已重置");
    expect(body).toContain("每月");
    expect(body).toContain("openai");
    // nextResetTime is rendered via zh-CN locale; just check presence.
    expect(body).toMatch(/下次重置/);
  });

  it("weaves keyword into title when includeKeyword is true", () => {
    const { title } = buildResetMarkdown(
      sub,
      "weekly",
      "2024-07-01T00:00:00Z",
      true
    );
    expect(title).toContain("【AI订阅】");
    expect(title).toContain("OpenAI Plus");
  });

  it("omits keyword when includeKeyword is false", () => {
    const { title } = buildResetMarkdown(
      sub,
      "weekly",
      "2024-07-01T00:00:00Z",
      false
    );
    expect(title).not.toContain("AI订阅");
  });
});

describe("buildDingtalkPayload (reset)", () => {
  const resetEvent: NotificationEvent = {
    kind: "reset",
    subscription: makeSub({ name: "OpenAI Plus" }),
    scheduleType: "monthly",
    nextResetTime: "2024-07-01T00:00:00Z",
    triggeredAt: "2024-06-01T00:00:00Z",
  };

  it("returns a markdown payload for a reset event", () => {
    const payload = buildDingtalkPayload(resetEvent, false);
    expect(payload.msgtype).toBe("markdown");
    expect(payload.markdown.title).toContain("OpenAI Plus");
    expect(payload.markdown.text).toContain("每月");
  });
});

describe("prepareSend (reset)", () => {
  const resetEvent: NotificationEvent = {
    kind: "reset",
    subscription: makeSub({ name: "OpenAI Plus" }),
    scheduleType: "weekly",
    nextResetTime: "2024-07-01T00:00:00Z",
    triggeredAt: "2024-06-01T00:00:00Z",
  };

  it("prepares a DingTalk reset payload with JSON content-type", () => {
    const ch = makeChannel();
    const prepared = prepareSend(ch, resetEvent);
    expect(prepared.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(prepared.body as string);
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.title).toContain("OpenAI Plus");
    expect(body.markdown.text).toContain("每周");
  });
});

// ============ Feishu ============

describe("buildFeishuPayload", () => {
  it("builds an interactive card with markdown element", () => {
    const ch = makeChannel({ type: "feishu" });
    const payload = buildFeishuPayload(lowBalanceEvent, ch);
    expect(payload.msg_type).toBe("interactive");
    expect(payload.card.header.title.tag).toBe("plain_text");
    expect(payload.card.header.title.content).toContain("Claude Pro");
    expect(payload.card.elements).toHaveLength(1);
    expect(payload.card.elements[0].tag).toBe("markdown");
    expect(payload.card.elements[0].content).toContain("5");
    expect(payload.card.elements[0].content).toContain("10");
  });

  it("omits timestamp/sign when channel has no secret", () => {
    const ch = makeChannel({ type: "feishu" });
    const payload = buildFeishuPayload(lowBalanceEvent, ch);
    expect(payload.timestamp).toBeUndefined();
    expect(payload.sign).toBeUndefined();
  });

  it("includes timestamp+sign when channel has a secret", () => {
    const ch = makeChannel({ type: "feishu", secret: "my-secret" });
    const payload = buildFeishuPayload(lowBalanceEvent, ch);
    expect(typeof payload.timestamp).toBe("string");
    expect(typeof payload.sign).toBe("string");
    expect(payload.sign!.length).toBeGreaterThan(0);
  });

  it("renders reset events with schedule type in markdown body", () => {
    const ch = makeChannel({ type: "feishu" });
    const resetEvent: NotificationEvent = {
      kind: "reset",
      subscription: makeSub({ name: "OpenAI Plus" }),
      scheduleType: "monthly",
      nextResetTime: "2024-07-01T00:00:00Z",
      triggeredAt: "2024-06-01T00:00:00Z",
    };
    const payload = buildFeishuPayload(resetEvent, ch);
    expect(payload.card.header.title.content).toContain("OpenAI Plus");
    expect(payload.card.header.title.content).toContain("配额已重置");
    expect(payload.card.elements[0].content).toContain("每月");
  });

  it("keyword is present only when channel has no secret", () => {
    const chNoSecret = makeChannel({ id: "a", type: "feishu" });
    const chWithSecret = makeChannel({
      id: "b",
      type: "feishu",
      secret: "s3cret",
    });
    const noSecret = buildFeishuPayload(lowBalanceEvent, chNoSecret);
    const withSecret = buildFeishuPayload(lowBalanceEvent, chWithSecret);
    expect(noSecret.card.header.title.content).toContain("AI订阅");
    expect(withSecret.card.header.title.content).not.toContain("AI订阅");
  });
});

// ============ Generic webhook ============

describe("buildWebhookPayload", () => {
  it("includes event discriminator and subscription metadata", () => {
    const payload = buildWebhookPayload(lowBalanceEvent);
    expect(payload.event).toBe("low-balance");
    expect(payload.timestamp).toBe("2024-06-01T00:00:00Z");
    expect(payload.subscription).toEqual({
      id: "sub-1",
      name: "Claude Pro",
      category: "AI助手",
      provider: "anthropic",
      subscriptionType: "one-time",
      price: 20,
    });
    expect(payload.balance).toBe(5);
    expect(payload.threshold).toBe(10);
    // Reset-only fields must NOT appear on a low-balance event.
    expect(payload.scheduleType).toBeUndefined();
    expect(payload.nextResetTime).toBeUndefined();
  });

  it("includes schedule fields and omits balance fields for reset events", () => {
    const resetEvent: NotificationEvent = {
      kind: "reset",
      subscription: makeSub({ name: "OpenAI Plus", provider: "openai" }),
      scheduleType: "weekly",
      nextResetTime: "2024-07-01T00:00:00Z",
      triggeredAt: "2024-06-01T00:00:00Z",
    };
    const payload = buildWebhookPayload(resetEvent);
    expect(payload.event).toBe("reset");
    expect(payload.scheduleType).toBe("weekly");
    expect(payload.nextResetTime).toBe("2024-07-01T00:00:00Z");
    expect(payload.balance).toBeUndefined();
    expect(payload.threshold).toBeUndefined();
  });
});

vi.useRealTimers();
