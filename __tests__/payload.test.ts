import { describe, it, expect, vi } from "vitest";
import type { NotificationChannel, Subscription } from "@/lib/types";
import {
  buildDingtalkPayload,
  buildDingtalkUrl,
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

  it("throws for feishu channel (deferred to follow-up ticket)", () => {
    const ch = makeChannel({ type: "feishu" });
    expect(() => prepareSend(ch, lowBalanceEvent)).toThrow(
      /not yet implemented/
    );
  });

  it("throws for webhook channel (deferred to follow-up ticket)", () => {
    const ch = makeChannel({ type: "webhook" });
    expect(() => prepareSend(ch, lowBalanceEvent)).toThrow(
      /not yet implemented/
    );
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

vi.useRealTimers();
