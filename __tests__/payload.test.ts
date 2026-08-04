import { describe, it, expect, vi } from "vitest";
import type { NotificationChannel, Subscription } from "@/lib/types";
import {
  buildDingtalkPayload,
  buildFeishuPayload,
  buildWebhookPayload,
  buildDingtalkUrl,
  buildLowBalanceMarkdown,
  prepareSend,
  NO_SECRET_KEYWORD,
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
  it("includes subscription name, balance, threshold and keyword", () => {
    const { title, body } = buildLowBalanceMarkdown(makeSub(), 5, 10);
    expect(title).toContain("Claude Pro");
    expect(body).toContain("Claude Pro");
    expect(body).toContain("5");
    expect(body).toContain("10");
    expect(body).toContain(NO_SECRET_KEYWORD);
  });
});

describe("buildDingtalkPayload", () => {
  it("returns msgtype=markdown with title and body", () => {
    const payload = buildDingtalkPayload(lowBalanceEvent);
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

describe("buildFeishuPayload", () => {
  it("returns interactive card with title and markdown", () => {
    const payload = buildFeishuPayload(lowBalanceEvent);
    expect(payload.msg_type).toBe("interactive");
    expect(payload.card.header.title.content).toContain("Claude Pro");
    expect(payload.card.elements[0].content).toContain("5");
  });
});

describe("buildWebhookPayload", () => {
  it("emits structured JSON with event kind and subscription info", () => {
    const payload = buildWebhookPayload(lowBalanceEvent);
    expect(payload.event).toBe("low-balance");
    expect(payload.subscription.id).toBe("sub-1");
    expect(payload.lowBalance?.balance).toBe(5);
    expect(payload.lowBalance?.threshold).toBe(10);
  });

  it("emits reset-tick payload for reset events", () => {
    const evt: NotificationEvent = {
      kind: "reset-tick",
      subscription: makeSub({ subscriptionType: "recurring" }),
      scheduleId: "sched-1",
      scheduleType: "monthly",
      nextResetTime: "2024-07-01T00:00:00Z",
      triggeredAt: "2024-06-01T00:00:00Z",
    };
    const payload = buildWebhookPayload(evt);
    expect(payload.event).toBe("reset-tick");
    expect(payload.resetTick?.scheduleId).toBe("sched-1");
  });
});

describe("prepareSend", () => {
  it("throws for disabled channels", () => {
    const ch = makeChannel({ enabled: false });
    expect(() => prepareSend(ch, lowBalanceEvent)).toThrow();
  });

  it("returns JSON body with Content-Type header", () => {
    const ch = makeChannel();
    const prepared = prepareSend(ch, lowBalanceEvent);
    expect(prepared.headers["Content-Type"]).toBe("application/json");
    expect(typeof prepared.body).toBe("string");
    JSON.parse(prepared.body as string);
  });
});

vi.useRealTimers();
