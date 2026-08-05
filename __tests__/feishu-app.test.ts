import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationChannel, Subscription } from "@/lib/types";
import type { NotificationEvent } from "@/lib/notifications/payload";
import {
  getTenantToken,
  buildFeishuAppCard,
  sendFeishuAppMessage,
  setNow,
  setFetchFn,
  resetSeams,
  clearTokenCache,
} from "@/lib/notifications/feishu-app";

// ============ Helpers ============

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

const lowBalanceEvent: NotificationEvent = {
  kind: "low-balance",
  subscription: makeSub(),
  balance: 5,
  threshold: 10,
  triggeredAt: "2024-06-01T00:00:00Z",
};

const resetEvent: NotificationEvent = {
  kind: "reset",
  subscription: makeSub(),
  scheduleType: "weekly",
  nextResetTime: "2024-06-08T00:00:00Z",
  triggeredAt: "2024-06-01T00:00:00Z",
};

// ============ Token cache ============

describe("getTenantToken", () => {
  beforeEach(() => {
    resetSeams();
  });

  it("fetches a token on first call", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          tenant_access_token: "t-token-1",
          expire: 7200,
        }),
    });
    setFetchFn(
      mockFetch as unknown as typeof setFetchFn extends (fn: infer F) => void
        ? F
        : never
    );
    setNow(() => 1000000);

    const token = await getTenantToken("app-id", "app-secret");

    expect(token).toBe("t-token-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      app_id: "app-id",
      app_secret: "app-secret",
    });
  });

  it("returns cached token on subsequent calls within expiry", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          tenant_access_token: "t-token-1",
          expire: 7200,
        }),
    });
    setFetchFn(mockFetch as never);
    let nowMs = 1000000;
    setNow(() => nowMs);

    await getTenantToken("app-id", "app-secret");
    nowMs += 1000; // 1s later
    const token = await getTenantToken("app-id", "app-secret");

    expect(token).toBe("t-token-1");
    expect(mockFetch).toHaveBeenCalledTimes(1); // still only 1 call
  });

  it("refreshes token after expiry buffer is reached", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token-1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token-2",
            expire: 7200,
          }),
      });
    setFetchFn(mockFetch as never);
    let nowMs = 1000000;
    setNow(() => nowMs);

    await getTenantToken("app-id", "app-secret");

    // Advance past the 5-minute buffer
    nowMs += 7200 * 1000; // to the exact expiry
    const token = await getTenantToken("app-id", "app-secret");

    expect(token).toBe("t-token-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh bypasses cache", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token-1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token-2",
            expire: 7200,
          }),
      });
    setFetchFn(mockFetch as never);
    setNow(() => 1000000);

    await getTenantToken("app-id", "app-secret");
    const token = await getTenantToken("app-id", "app-secret", true);

    expect(token).toBe("t-token-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws when token response has non-zero code", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 10003, msg: "invalid app_id" }),
    });
    setFetchFn(mockFetch as never);
    setNow(() => 1000000);

    await expect(getTenantToken("bad", "bad")).rejects.toThrow(/code=10003/);
  });

  it("throws when HTTP response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("server error"),
    });
    setFetchFn(mockFetch as never);
    setNow(() => 1000000);

    await expect(getTenantToken("app-id", "app-secret")).rejects.toThrow(
      /HTTP 500/
    );
  });

  it("caches tokens per appId - different apps have separate caches", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app2",
            expire: 7200,
          }),
      });
    setFetchFn(mockFetch as never);
    setNow(() => 1000000);

    // First app
    const token1 = await getTenantToken("app-1", "secret-1");
    expect(token1).toBe("token-app1");

    // Second app - should fetch new token, not reuse first app's cache
    const token2 = await getTenantToken("app-2", "secret-2");
    expect(token2).toBe("token-app2");

    // First app again - should use cache, not fetch again
    const token1Again = await getTenantToken("app-1", "secret-1");
    expect(token1Again).toBe("token-app1");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("clearTokenCache(appId) clears only that app's cache", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app1-v1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app2-v1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app1-v2",
            expire: 7200,
          }),
      });
    setFetchFn(mockFetch as never);
    setNow(() => 1000000);

    await getTenantToken("app-1", "secret-1");
    await getTenantToken("app-2", "secret-2");

    // Clear only app-1's cache
    clearTokenCache("app-1");

    // app-1 should fetch new token
    const token1New = await getTenantToken("app-1", "secret-1");
    expect(token1New).toBe("token-app1-v2");

    // app-2 should still use cached token
    const token2Again = await getTenantToken("app-2", "secret-2");
    expect(token2Again).toBe("token-app2-v1");

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("clearTokenCache() without args clears all caches", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app1-v1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app2-v1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app1-v2",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "token-app2-v2",
            expire: 7200,
          }),
      });
    setFetchFn(mockFetch as never);
    setNow(() => 1000000);

    await getTenantToken("app-1", "secret-1");
    await getTenantToken("app-2", "secret-2");

    // Clear all caches
    clearTokenCache();

    // Both apps should fetch new tokens
    const token1New = await getTenantToken("app-1", "secret-1");
    const token2New = await getTenantToken("app-2", "secret-2");
    expect(token1New).toBe("token-app1-v2");
    expect(token2New).toBe("token-app2-v2");

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

// ============ Card payload ============

describe("buildFeishuAppCard", () => {
  it("builds a valid interactive card JSON string for low-balance event", () => {
    const cardStr = buildFeishuAppCard(lowBalanceEvent);
    const card = JSON.parse(cardStr);

    expect(card.header.title.tag).toBe("plain_text");
    expect(card.header.title.content).toContain("Claude Pro");
    expect(card.header.title.content).toContain("余额不足");
    expect(card.elements).toHaveLength(1);
    expect(card.elements[0].tag).toBe("markdown");
    expect(card.elements[0].content).toContain("Claude Pro");
    expect(card.elements[0].content).toContain("当前余额");
  });

  it("builds a valid card for reset event", () => {
    const cardStr = buildFeishuAppCard(resetEvent);
    const card = JSON.parse(cardStr);

    expect(card.header.title.content).toContain("配额已重置");
    expect(card.elements[0].content).toContain("重置计划");
  });

  it("does not include keyword in title (feishu-app uses credential auth)", () => {
    const cardStr = buildFeishuAppCard(lowBalanceEvent);
    const card = JSON.parse(cardStr);

    expect(card.header.title.content).not.toContain("【AI订阅】");
  });
});

// ============ Send with retry ============

describe("sendFeishuAppMessage", () => {
  const channel = {
    appId: "app-id",
    appSecret: "app-secret",
    receiveId: "ou_xxx",
    receiveIdType: "open_id",
  };

  beforeEach(() => {
    resetSeams();
    setNow(() => 1000000);
  });

  it("sends a message with the fetched token", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        // token fetch
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token-1",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        // send message
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({ code: 0, msg: "success" })),
      });
    setFetchFn(mockFetch as never);

    await sendFeishuAppMessage(lowBalanceEvent, channel);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [sendUrl, sendInit] = mockFetch.mock.calls[1];
    expect(sendUrl).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id"
    );
    expect(sendInit.headers.Authorization).toBe("Bearer t-token-1");
    const sendBody = JSON.parse(sendInit.body);
    expect(sendBody.receive_id).toBe("ou_xxx");
    expect(sendBody.msg_type).toBe("interactive");
    expect(JSON.parse(sendBody.content).header.title.content).toContain(
      "Claude Pro"
    );
  });

  it("retries once on 401 with fresh token", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        // first token fetch
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-old",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        // first send → 401
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 99991663, msg: "invalid token" })
          ),
      })
      .mockResolvedValueOnce({
        // force-refreshed token
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-new",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        // retry send → success
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ code: 0 })),
      });
    setFetchFn(mockFetch as never);

    await sendFeishuAppMessage(lowBalanceEvent, channel);

    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Second send should use the new token
    const [, retryInit] = mockFetch.mock.calls[3];
    expect(retryInit.headers.Authorization).toBe("Bearer t-new");
  });

  it("retries once on code 99991663 even with 200 status", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-old",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 99991663, msg: "token expired" })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-new",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ code: 0 })),
      });
    setFetchFn(mockFetch as never);

    await sendFeishuAppMessage(lowBalanceEvent, channel);

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("throws after retry also fails", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-old",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-new",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        // retry still fails
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      });
    setFetchFn(mockFetch as never);

    await expect(
      sendFeishuAppMessage(lowBalanceEvent, channel)
    ).rejects.toThrow(/HTTP 401/);

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("uses chat_id receive_id_type when configured", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ code: 0 })),
      });
    setFetchFn(mockFetch as never);

    await sendFeishuAppMessage(lowBalanceEvent, {
      ...channel,
      receiveId: "oc_yyy",
      receiveIdType: "chat_id",
    });

    const [sendUrl] = mockFetch.mock.calls[1];
    expect(sendUrl).toContain("receive_id_type=chat_id");
    const sendBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(sendBody.receive_id).toBe("oc_yyy");
  });
});

// ============ Dispatch fanout ============

describe("dispatchEvent with feishu-app", () => {
  beforeEach(() => {
    resetSeams();
  });

  it("routes feishu-app channel to feishuAppSender, others to httpSender", async () => {
    const { dispatchEvent } = await import("@/lib/notifications/dispatcher");
    const { prepareSend } = await import("@/lib/notifications/payload");

    const webhookChannel: NotificationChannel = {
      id: "ch-webhook",
      type: "webhook",
      name: "Webhook",
      url: "https://example.com/hook",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const feishuAppChannel: NotificationChannel = {
      id: "ch-feishu-app",
      type: "feishu-app",
      name: "Feishu App",
      appId: "app-id",
      appSecret: "app-secret",
      receiveId: "ou_xxx",
      receiveIdType: "open_id",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const dingtalkChannel: NotificationChannel = {
      id: "ch-dingtalk",
      type: "dingtalk",
      name: "Dingtalk",
      url: "https://oapi.dingtalk.com/robot/send",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const httpCalls: Array<{ url: string }> = [];
    const feishuAppCalls: Array<{ channelName: string }> = [];

    const httpSender = vi.fn(async (send) => {
      httpCalls.push({ url: send.url });
    });
    const feishuAppSender = vi.fn(async (_event, ch) => {
      feishuAppCalls.push({ channelName: ch.name });
    });

    // Mock storage for dispatchEvent
    vi.doMock("@/lib/notifications/storage", () => ({
      updateChannelSendResult: () => {},
    }));

    const channels = [webhookChannel, feishuAppChannel, dingtalkChannel];
    const count = await dispatchEvent(
      lowBalanceEvent,
      channels,
      httpSender,
      feishuAppSender
    );

    expect(count).toBe(3);
    expect(httpSender).toHaveBeenCalledTimes(2); // webhook + dingtalk
    expect(feishuAppSender).toHaveBeenCalledTimes(1);
    expect(feishuAppCalls[0].channelName).toBe("Feishu App");
  });
});

// ============ Credentials helper ============

describe("feishuAppCredentials", () => {
  it("extracts credentials from a valid feishu-app channel", async () => {
    const { feishuAppCredentials } =
      await import("@/lib/notifications/feishu-app");
    const channel: NotificationChannel = {
      id: "ch-1",
      type: "feishu-app",
      name: "Test",
      appId: "app-id",
      appSecret: "app-secret",
      receiveId: "ou_xxx",
      receiveIdType: "open_id",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const creds = feishuAppCredentials(channel);
    expect(creds).toEqual({
      appId: "app-id",
      appSecret: "app-secret",
      receiveId: "ou_xxx",
      receiveIdType: "open_id",
    });
  });

  it("throws when channel is not feishu-app type", async () => {
    const { feishuAppCredentials } =
      await import("@/lib/notifications/feishu-app");
    const channel: NotificationChannel = {
      id: "ch-1",
      type: "webhook",
      name: "Test",
      url: "https://example.com",
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    expect(() => feishuAppCredentials(channel)).toThrow(
      /not a feishu-app channel/
    );
  });

  it("throws when required fields are missing", async () => {
    const { feishuAppCredentials } =
      await import("@/lib/notifications/feishu-app");
    const channel: NotificationChannel = {
      id: "ch-1",
      type: "feishu-app",
      name: "Test",
      appId: "app-id",
      // missing appSecret, receiveId, receiveIdType
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    expect(() => feishuAppCredentials(channel)).toThrow(
      /missing required fields/
    );
  });
});
