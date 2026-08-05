import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listFeishuChats,
  lookupFeishuUserByPhone,
  translateFeishuError,
} from "@/lib/notifications/feishu-helpers";
import { setNow, setFetchFn, resetSeams } from "@/lib/notifications/feishu-app";

// ============ Error translation ============

describe("translateFeishuError", () => {
  it("translates known error codes to human-readable messages", () => {
    const msg = translateFeishuError(99991663);
    expect(msg).toContain("tenant_access_token");
    expect(msg).toContain("无效");
  });

  it("translates permission error code", () => {
    const msg = translateFeishuError(99991400);
    expect(msg).toContain("权限不足");
    expect(msg).toContain("飞书开放平台");
  });

  it("translates chat list specific error codes", () => {
    const msg = translateFeishuError(1254043);
    expect(msg).toContain("im:chat:readonly");
  });

  it("translates contact lookup error codes", () => {
    const msg = translateFeishuError(1254003);
    expect(msg).toContain("contact:user.id:readonly");
  });

  it("returns null for unknown error codes", () => {
    const msg = translateFeishuError(9999999);
    expect(msg).toBeNull();
  });
});

// ============ listFeishuChats ============

describe("listFeishuChats", () => {
  beforeEach(() => {
    resetSeams();
    setNow(() => 1000000);
  });

  it("fetches chat list with token auth", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        // token fetch
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: "t-token",
            expire: 7200,
          }),
      })
      .mockResolvedValueOnce({
        // chat list fetch
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 0,
              data: {
                items: [
                  { chat_id: "oc_abc", name: "Test Group" },
                  { chat_id: "oc_def", name: "Another Group" },
                ],
                has_more: false,
              },
            })
          ),
      });
    setFetchFn(mockFetch as never);

    const result = await listFeishuChats("app-id", "app-secret");

    expect(result.items).toHaveLength(2);
    expect(result.items[0].chat_id).toBe("oc_abc");
    expect(result.items[0].name).toBe("Test Group");
    expect(result.has_more).toBe(false);

    // Verify chat list URL
    const [chatUrl, chatInit] = mockFetch.mock.calls[1];
    expect(chatUrl).toContain("/open-apis/im/v1/chats");
    expect(chatUrl).toContain("page_size=50");
    expect(chatInit.headers.Authorization).toBe("Bearer t-token");
  });

  it("supports pagination with page_token", async () => {
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
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 0,
              data: {
                items: [{ chat_id: "oc_page2", name: "Page 2 Group" }],
                has_more: false,
                page_token: "prev_token",
              },
            })
          ),
      });
    setFetchFn(mockFetch as never);

    const result = await listFeishuChats("app-id", "app-secret", {
      page_token: "some_token",
      page_size: 10,
    });

    const [chatUrl] = mockFetch.mock.calls[1];
    expect(chatUrl).toContain("page_token=some_token");
    expect(chatUrl).toContain("page_size=10");
    expect(result.items[0].chat_id).toBe("oc_page2");
  });

  it("throws translated error on non-zero code", async () => {
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
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 1254043,
              msg: "permission denied",
            })
          ),
      });
    setFetchFn(mockFetch as never);

    await expect(listFeishuChats("app-id", "app-secret")).rejects.toThrow(
      /im:chat:readonly/
    );
  });

  it("throws on HTTP error", async () => {
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
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 99991663, msg: "invalid token" })
          ),
      });
    setFetchFn(mockFetch as never);

    await expect(listFeishuChats("app-id", "app-secret")).rejects.toThrow(
      /tenant_access_token/
    );
  });
});

// ============ lookupFeishuUserByPhone ============

describe("lookupFeishuUserByPhone", () => {
  beforeEach(() => {
    resetSeams();
    setNow(() => 1000000);
  });

  it("looks up user by phone number", async () => {
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
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 0,
              data: {
                user_list: [
                  {
                    user_id: { open_id: "ou_abc123" },
                    mobile: "+8613800138000",
                  },
                ],
              },
            })
          ),
      });
    setFetchFn(mockFetch as never);

    const result = await lookupFeishuUserByPhone("app-id", "app-secret", [
      "+8613800138000",
    ]);

    expect(result.user_list).toHaveLength(1);
    expect(result.user_list[0].user_id.open_id).toBe("ou_abc123");
    expect(result.user_list[0].mobile).toBe("+8613800138000");

    // Verify POST body
    const [lookupUrl, lookupInit] = mockFetch.mock.calls[1];
    expect(lookupUrl).toBe(
      "https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id"
    );
    expect(lookupInit.method).toBe("POST");
    const body = JSON.parse(lookupInit.body);
    expect(body.mobiles).toEqual(["+8613800138000"]);
  });

  it("throws when mobiles array is empty", async () => {
    await expect(
      lookupFeishuUserByPhone("app-id", "app-secret", [])
    ).rejects.toThrow(/不能为空/);
  });

  it("throws translated error on permission denied", async () => {
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
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 1254003,
              msg: "permission denied",
            })
          ),
      });
    setFetchFn(mockFetch as never);

    await expect(
      lookupFeishuUserByPhone("app-id", "app-secret", ["+8613800138000"])
    ).rejects.toThrow(/contact:user.id:readonly/);
  });

  it("returns empty user_list when no match found", async () => {
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
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 0,
              data: { user_list: [] },
            })
          ),
      });
    setFetchFn(mockFetch as never);

    const result = await lookupFeishuUserByPhone("app-id", "app-secret", [
      "+8613800138000",
    ]);
    expect(result.user_list).toHaveLength(0);
  });
});
