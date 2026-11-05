// Component coverage for the notification channel list (#44): the two channel
// families, badges, last-send state and the row actions.

import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelList, type TestFlash } from "./ChannelList";
import type { ChannelView } from "./types";

const channels: ChannelView[] = [
  {
    id: "ch-webhook",
    type: "webhook",
    name: "值班 Webhook",
    url: "https://example.com/hooks/abcdefghijklmnopqrstuvwxyz0123456789",
    enabled: true,
    hasSecret: true,
    hasAppSecret: false,
    lastSendResult: {
      success: true,
      timestamp: "2026-01-02T03:04:05.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ch-feishu",
    type: "feishu-app",
    name: "飞书告警",
    appId: "cli_abc123",
    receiveId: "oc_chat_1",
    receiveIdType: "chat_id",
    enabled: false,
    hasSecret: false,
    hasAppSecret: true,
    lastSendResult: {
      success: false,
      timestamp: "2026-01-02T03:04:05.000Z",
      error: "签名校验失败",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const noTesting = () => new Set<string>();
const noFlashes = () => ({}) as Record<string, TestFlash>;

afterEach(cleanup);

describe("ChannelList", () => {
  it("renders webhook and feishu-app channels with their metadata", () => {
    render(() => (
      <ChannelList
        channels={channels}
        testingIds={noTesting}
        flashes={noFlashes}
        onTest={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    ));

    expect(screen.getByText("值班 Webhook")).toBeTruthy();
    expect(screen.getByText("飞书告警")).toBeTruthy();
    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(screen.getByText("飞书应用")).toBeTruthy();
    expect(screen.getAllByText("已启用")).toHaveLength(1);
    expect(screen.getAllByText("已禁用")).toHaveLength(1);

    expect(screen.getByText(/已配置签名/)).toBeTruthy();
    expect(screen.getByText(/App ID: cli_abc123/)).toBeTruthy();
    expect(screen.getByText(/群聊:oc_chat_1/)).toBeTruthy();
    expect(screen.getByText(/已配置 App Secret/)).toBeTruthy();

    expect(screen.getByText(/^成功 ·/)).toBeTruthy();
    expect(screen.getByText(/^失败 ·.*签名校验失败/)).toBeTruthy();
  });

  it("renders the empty state when no channels exist", () => {
    render(() => (
      <ChannelList
        channels={[]}
        testingIds={noTesting}
        flashes={noFlashes}
        onTest={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    ));

    expect(
      screen.getByText("暂无渠道。点击「添加渠道」开始配置通知。")
    ).toBeTruthy();
  });

  it("wires the row actions to the channel they belong to", () => {
    const onTest = vi.fn();
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(() => (
      <ChannelList
        channels={channels}
        testingIds={noTesting}
        flashes={noFlashes}
        onTest={onTest}
        onToggle={onToggle}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    ));

    const [firstTest] = screen.getAllByRole("button", { name: "测试发送" });
    fireEvent.click(firstTest);
    expect(onTest).toHaveBeenCalledWith(channels[0]);

    fireEvent.click(screen.getAllByRole("button", { name: "禁用" })[0]);
    expect(onToggle).toHaveBeenCalledWith(channels[0]);

    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
    expect(onEdit).toHaveBeenCalledWith(channels[0]);

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    expect(onDelete).toHaveBeenCalledWith(channels[0]);
  });

  it("shows the per-channel test flash", () => {
    render(() => (
      <ChannelList
        channels={[channels[0]]}
        testingIds={noTesting}
        flashes={() => ({
          "ch-webhook": { success: false, message: "网络不可达" },
        })}
        onTest={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    ));

    expect(screen.getByText("网络不可达")).toBeTruthy();
  });
});
