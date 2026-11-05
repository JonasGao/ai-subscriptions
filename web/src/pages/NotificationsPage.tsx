// Notifications settings page (#44), ported from app/notifications/page.tsx:
// channel CRUD/toggle/test-send, the global low-balance threshold, and the
// feishu-app configuration dialog with its chat/user/listen helpers.

import { Show, createSignal, onMount, type Component } from "solid-js";
import { MainPageShell } from "../components/MainPageShell";
import {
  createChannel,
  deleteChannel,
  fetchNotificationsConfig,
  testChannel,
  toggleChannel,
  updateChannel,
  updateDefaultThreshold,
} from "../notifications/api";
import { ChannelList, type TestFlash } from "../notifications/ChannelList";
import { ChannelFormDialog } from "../notifications/ChannelFormDialog";
import type {
  ChannelPayload,
  ChannelView,
  NotificationsConfig,
} from "../notifications/types";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const NotificationsPage: Component = () => {
  const [config, setConfig] = createSignal<NotificationsConfig | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<ChannelView | null>(null);

  const [testingIds, setTestingIds] = createSignal<Set<string>>(new Set());
  const [flashes, setFlashes] = createSignal<Record<string, TestFlash>>({});

  const [thresholdInput, setThresholdInput] = createSignal("");
  const [thresholdSaving, setThresholdSaving] = createSignal(false);
  const [thresholdDirty, setThresholdDirty] = createSignal(false);

  const load = async () => {
    try {
      const data = await fetchNotificationsConfig();
      setConfig(data);
      setThresholdInput(String(data.defaultLowBalanceThreshold));
      setThresholdDirty(false);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (channel: ChannelView) => {
    setEditing(channel);
    setDialogOpen(true);
  };

  const saveChannel = async (id: string | null, payload: ChannelPayload) => {
    if (id) await updateChannel(id, payload);
    else await createChannel(payload);
    await load();
  };

  const handleDelete = async (channel: ChannelView) => {
    if (!window.confirm(`确定要删除渠道「${channel.name}」吗？`)) return;
    setError(null);
    try {
      await deleteChannel(channel.id);
      await load();
    } catch (deleteError) {
      setError(messageOf(deleteError));
    }
  };

  const handleToggle = async (channel: ChannelView) => {
    setError(null);
    try {
      await toggleChannel(channel.id);
      await load();
    } catch (toggleError) {
      setError(messageOf(toggleError));
    }
  };

  const handleTest = async (channel: ChannelView) => {
    setTestingIds((previous) => new Set(previous).add(channel.id));
    setFlashes((previous) => {
      const next = { ...previous };
      delete next[channel.id];
      return next;
    });
    try {
      await testChannel(channel.id);
      setFlashes((previous) => ({
        ...previous,
        [channel.id]: { success: true, message: "测试消息已发送" },
      }));
    } catch (testError) {
      setFlashes((previous) => ({
        ...previous,
        [channel.id]: { success: false, message: messageOf(testError) },
      }));
    } finally {
      setTestingIds((previous) => {
        const next = new Set(previous);
        next.delete(channel.id);
        return next;
      });
    }
    await load();
  };

  const saveThreshold = async () => {
    const value = Number(thresholdInput());
    if (!Number.isFinite(value) || value < 0) {
      setError("阈值必须是非负数字");
      return;
    }
    setThresholdSaving(true);
    setError(null);
    try {
      const result = await updateDefaultThreshold(value);
      setConfig((previous) =>
        previous
          ? {
              ...previous,
              defaultLowBalanceThreshold: result.defaultLowBalanceThreshold,
            }
          : previous
      );
      setThresholdDirty(false);
    } catch (thresholdError) {
      setError(messageOf(thresholdError));
    } finally {
      setThresholdSaving(false);
    }
  };

  return (
    <MainPageShell activePage="notifications">
      <main class="notifications-page">
        <header class="notifications-header">
          <div>
            <a class="notifications-back" href="/subscriptions">
              ← 返回订阅
            </a>
            <h1>通知设置</h1>
            <p class="tagline">管理通知渠道与全局默认低余额阈值</p>
          </div>
          <button type="button" class="primary" onClick={openAdd}>
            添加渠道
          </button>
        </header>

        <Show when={error()}>
          {(message) => (
            <div class="error-banner" role="alert">
              <span>{message()}</span>
              <button
                type="button"
                aria-label="关闭错误提示"
                onClick={() => setError(null)}
              >
                ×
              </button>
            </div>
          )}
        </Show>

        <Show when={!loading()} fallback={<p class="loading">加载中...</p>}>
          <Show
            when={config()}
            fallback={<p class="notifications-empty">加载失败：{error()}</p>}
          >
            {(data) => (
              <>
                <section class="notifications-threshold">
                  <h2>全局默认低余额阈值</h2>
                  <p class="notifications-threshold-hint">
                    一次性订阅未单独设置阈值时使用此值。修改后对未自定义阈值的订阅立即生效。
                  </p>
                  <div class="notifications-threshold-row">
                    <label for="threshold">
                      <span>阈值</span>
                      <input
                        id="threshold"
                        type="number"
                        min={0}
                        step="0.01"
                        value={thresholdInput()}
                        onInput={(event) => {
                          setThresholdInput(event.currentTarget.value);
                          setThresholdDirty(true);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={thresholdSaving() || !thresholdDirty()}
                      onClick={() => void saveThreshold()}
                    >
                      {thresholdSaving() ? "保存中" : "保存"}
                    </button>
                  </div>
                </section>

                <section>
                  <h2 class="notifications-section-title">通知渠道</h2>
                  <ChannelList
                    channels={data().channels}
                    testingIds={testingIds}
                    flashes={flashes}
                    onTest={(channel) => void handleTest(channel)}
                    onToggle={(channel) => void handleToggle(channel)}
                    onEdit={openEdit}
                    onDelete={(channel) => void handleDelete(channel)}
                  />
                </section>
              </>
            )}
          </Show>
        </Show>

        <ChannelFormDialog
          open={dialogOpen()}
          channel={editing()}
          onOpenChange={setDialogOpen}
          onSave={saveChannel}
        />
      </main>
    </MainPageShell>
  );
};
