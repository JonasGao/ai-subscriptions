// Channel list cards (#44), ported from the list section of
// app/notifications/page.tsx: type/enabled badges, channel metadata, the last
// send result, a per-channel test flash and the four row actions.

import { For, Show, type Accessor, type Component } from "solid-js";
import {
  CHANNEL_TYPE_LABELS,
  type ChannelView,
  type SendResult,
} from "./types";

export interface TestFlash {
  success: boolean;
  message: string;
}

export interface ChannelListProps {
  channels: ChannelView[];
  testingIds: Accessor<Set<string>>;
  flashes: Accessor<Record<string, TestFlash>>;
  onTest: (channel: ChannelView) => void;
  onToggle: (channel: ChannelView) => void;
  onEdit: (channel: ChannelView) => void;
  onDelete: (channel: ChannelView) => void;
}

function formatSendResult(result: SendResult | undefined): {
  label: string;
  tone: "success" | "error" | "muted";
} {
  if (!result) return { label: "尚未发送", tone: "muted" };
  const time = new Date(result.timestamp).toLocaleString("zh-CN");
  if (result.success) return { label: `成功 · ${time}`, tone: "success" };
  return {
    label: `失败 · ${time}${result.error ? ` · ${result.error}` : ""}`,
    tone: "error",
  };
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}

export const ChannelList: Component<ChannelListProps> = (props) => (
  <Show
    when={props.channels.length > 0}
    fallback={
      <p class="notifications-empty">
        暂无渠道。点击「添加渠道」开始配置通知。
      </p>
    }
  >
    <ul class="notification-list">
      <For each={props.channels}>
        {(channel) => {
          const sendInfo = () => formatSendResult(channel.lastSendResult);
          const flash = () => props.flashes()[channel.id];
          const testing = () => props.testingIds().has(channel.id);
          return (
            <li class="notification-card">
              <div class="notification-card-main">
                <div class="notification-badges">
                  <span class="notification-name">{channel.name}</span>
                  <span class="notification-badge notification-badge-type">
                    {CHANNEL_TYPE_LABELS[channel.type]}
                  </span>
                  <span
                    classList={{
                      "notification-badge": true,
                      "notification-badge-enabled": channel.enabled,
                      "notification-badge-disabled": !channel.enabled,
                    }}
                  >
                    {channel.enabled ? "已启用" : "已禁用"}
                  </span>
                </div>

                <p class="notification-meta">
                  <Show
                    when={channel.type === "feishu-app"}
                    fallback={
                      <>
                        <span>{truncateUrl(channel.url ?? "")}</span>
                        <Show when={channel.hasSecret}>
                          <span class="notification-secret">· 已配置签名</span>
                        </Show>
                      </>
                    }
                  >
                    <span>App ID: {channel.appId ?? "-"}</span>
                    <span> · </span>
                    <span>
                      {channel.receiveIdType === "open_id" ? "单聊" : "群聊"}:
                      {channel.receiveId ?? "-"}
                    </span>
                    <Show when={channel.hasAppSecret}>
                      <span class="notification-secret">
                        · 已配置 App Secret
                      </span>
                    </Show>
                  </Show>
                </p>

                <p
                  classList={{
                    "notification-send-state": true,
                    [`notification-send-${sendInfo().tone}`]: true,
                  }}
                >
                  {sendInfo().label}
                </p>

                <Show when={flash()}>
                  {(info) => (
                    <p
                      classList={{
                        "notification-flash": true,
                        success: info().success,
                        error: !info().success,
                      }}
                      role="status"
                    >
                      {info().message}
                    </p>
                  )}
                </Show>
              </div>

              <div class="notification-card-actions">
                <button
                  type="button"
                  disabled={testing() || !channel.enabled}
                  title={channel.enabled ? "发送一条测试消息" : "请先启用渠道"}
                  onClick={() => props.onTest(channel)}
                >
                  {testing() ? "发送中" : "测试发送"}
                </button>
                <button
                  type="button"
                  aria-label={channel.enabled ? "禁用" : "启用"}
                  title={channel.enabled ? "禁用" : "启用"}
                  onClick={() => props.onToggle(channel)}
                >
                  {channel.enabled ? "禁用" : "启用"}
                </button>
                <button
                  type="button"
                  aria-label="编辑"
                  title="编辑"
                  onClick={() => props.onEdit(channel)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  class="danger"
                  aria-label="删除"
                  title="删除"
                  onClick={() => props.onDelete(channel)}
                >
                  删除
                </button>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  </Show>
);
