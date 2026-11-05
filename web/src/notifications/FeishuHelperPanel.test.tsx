// Feishu helper panel coverage (#44): chat picker, phone lookup, WS listener
// start/stop status and the stored-secret channelId fallback.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuHelperPanel } from "./FeishuHelperPanel";
import { stubFetch } from "../test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FeishuHelperPanel", () => {
  it("lists chats and fills the selected chat id", async () => {
    const onSelect = vi.fn();
    stubFetch({
      "POST /api/notifications/feishu-app/chats": {
        body: {
          items: [{ chat_id: "oc_1", name: "测试群" }],
          has_more: false,
        },
      },
    });

    render(() => (
      <FeishuHelperPanel
        appId="cli_abc"
        appSecret="secret"
        channelId={null}
        hasStoredSecret={false}
        onSelect={onSelect}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "从群列表选择" }));
    await screen.findByText("测试群");
    fireEvent.click(screen.getByText("测试群"));

    expect(onSelect).toHaveBeenCalledWith("oc_1", "chat_id");
  });

  it("resolves a phone number to an open_id", async () => {
    const onSelect = vi.fn();
    stubFetch({
      "POST /api/notifications/feishu-app/lookup-user": {
        body: {
          user_list: [
            { user_id: { open_id: "ou_user" }, mobile: "+8613800138000" },
          ],
        },
      },
    });

    render(() => (
      <FeishuHelperPanel
        appId="cli_abc"
        appSecret="secret"
        channelId={null}
        hasStoredSecret={false}
        onSelect={onSelect}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "手机号查询" }));
    fireEvent.input(screen.getByLabelText("手机号"), {
      target: { value: "+8613800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await screen.findByText("+8613800138000");
    fireEvent.click(screen.getByText("+8613800138000"));
    expect(onSelect).toHaveBeenCalledWith("ou_user", "open_id");
  });

  it("shows the WS listener status and stops it", async () => {
    const fetchMock = stubFetch({
      "POST /api/notifications/feishu-app/listen": {
        body: {
          appId: "cli_abc",
          listenId: "listen-1",
          startedAt: "2026-01-01T00:00:00.000Z",
          messageCount: 0,
          stopped: false,
          ttlSeconds: 120,
        },
      },
      "DELETE /api/notifications/feishu-app/listen": {
        body: { success: true },
      },
    });

    render(() => (
      <FeishuHelperPanel
        appId="cli_abc"
        appSecret="secret"
        channelId={null}
        hasStoredSecret={false}
        onSelect={() => {}}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "通过消息获取" }));
    expect(await screen.findByText(/正在监听/)).toBeTruthy();
    expect(screen.getByText(/2分钟后自动停止/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "停止监听" }));

    await screen.findByText("监听已停止。点击「通过消息获取」重新启动。");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).startsWith("/api/notifications/feishu-app/listen") &&
          (init as RequestInit | undefined)?.method === "DELETE"
      )
    ).toBe(true);
  });

  it("reuses the stored appSecret through channelId when editing", async () => {
    const fetchMock = stubFetch({
      "POST /api/notifications/feishu-app/chats": {
        body: { items: [], has_more: false },
      },
    });

    render(() => (
      <FeishuHelperPanel
        appId="cli_abc"
        appSecret=""
        channelId="ch-1"
        hasStoredSecret
        onSelect={() => {}}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "从群列表选择" }));
    await screen.findByText("机器人不在任何群中。请先将机器人添加到群聊。");

    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/feishu-app/chats")
    );
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({ appId: "cli_abc", channelId: "ch-1" });
  });
});
