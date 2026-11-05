// Feishu helpers inside the channel dialog (#44): list the bot's chats, resolve
// a phone number to an open_id, and watch a WebSocket long connection for
// messages. Ported from the helper section of app/notifications/page.tsx.

import { For, Show, createSignal, onCleanup, type Component } from "solid-js";
import type { FeishuReceiveIdType } from "./types";
import {
  NotificationApiError,
  listFeishuChats,
  lookupFeishuUsers,
  pollFeishuListen,
  startFeishuListen,
  stopFeishuListen,
  type FeishuChatList,
  type FeishuHelperBody,
} from "./api";
import { findPermissionByScope } from "./permissions";

type HelperMode = "none" | "chats" | "phone" | "listen";

interface CapturedUser {
  open_id: string;
  mobile?: string;
  name?: string;
}

interface CapturedMessage {
  open_id: string;
  name?: string;
  message_id: string;
  receivedAt: string;
}

export interface FeishuHelperPanelProps {
  appId: string;
  appSecret: string;
  /** Set while editing: lets helpers reuse the stored appSecret. */
  channelId?: string | null;
  hasStoredSecret: boolean;
  onSelect: (receiveId: string, receiveIdType: FeishuReceiveIdType) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const FeishuHelperPanel: Component<FeishuHelperPanelProps> = (props) => {
  const [mode, setMode] = createSignal<HelperMode>("none");

  const [chatsLoading, setChatsLoading] = createSignal(false);
  const [chatsLoadingMore, setChatsLoadingMore] = createSignal(false);
  const [chatsError, setChatsError] = createSignal<string | null>(null);
  const [chatsResult, setChatsResult] = createSignal<FeishuChatList | null>(
    null
  );

  const [phoneInput, setPhoneInput] = createSignal("");
  const [phoneLoading, setPhoneLoading] = createSignal(false);
  const [phoneError, setPhoneError] = createSignal<string | null>(null);
  const [phoneResult, setPhoneResult] = createSignal<CapturedUser[] | null>(
    null
  );

  const [listenLoading, setListenLoading] = createSignal(false);
  const [listenError, setListenError] = createSignal<string | null>(null);
  const [listenActive, setListenActive] = createSignal(false);
  const [listenId, setListenId] = createSignal<string | null>(null);
  const [listenTtlSeconds, setListenTtlSeconds] = createSignal<number | null>(
    null
  );
  const [listenMessages, setListenMessages] = createSignal<CapturedMessage[]>(
    []
  );
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const clearPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  onCleanup(clearPoll);

  /** Whether direct or stored credentials are available for a helper call. */
  const hasCredentials = () =>
    props.appId.trim() !== "" &&
    (props.appSecret.trim() !== "" ||
      (Boolean(props.channelId) && props.hasStoredSecret));

  const helperBody = (extra: FeishuHelperBody = {}): FeishuHelperBody => {
    const body: FeishuHelperBody = { ...extra };
    if (props.appId.trim()) body.appId = props.appId.trim();
    if (props.appSecret.trim()) {
      body.appSecret = props.appSecret.trim();
    } else if (props.channelId && props.hasStoredSecret) {
      body.channelId = props.channelId;
    }
    return body;
  };

  // ---------- Chat picker ----------

  const fetchChats = async () => {
    setMode("chats");
    setChatsLoading(true);
    setChatsError(null);
    setChatsResult(null);
    try {
      setChatsResult(await listFeishuChats(helperBody()));
    } catch (error) {
      setChatsError(messageOf(error));
    } finally {
      setChatsLoading(false);
    }
  };

  const loadMoreChats = async () => {
    const current = chatsResult();
    if (!current?.has_more || !current.page_token) return;
    setChatsLoadingMore(true);
    setChatsError(null);
    try {
      const next = await listFeishuChats(
        helperBody({ page_token: current.page_token })
      );
      setChatsResult({
        ...next,
        items: [...current.items, ...(next.items ?? [])],
      });
    } catch (error) {
      setChatsError(messageOf(error));
    } finally {
      setChatsLoadingMore(false);
    }
  };

  const selectChat = (chatId: string) => {
    props.onSelect(chatId, "chat_id");
    setMode("none");
  };

  // ---------- Phone lookup ----------

  const lookupPhone = async () => {
    const phone = phoneInput().trim();
    if (!phone) {
      setPhoneError("请输入手机号");
      return;
    }
    setMode("phone");
    setPhoneLoading(true);
    setPhoneError(null);
    setPhoneResult(null);
    try {
      const data = await lookupFeishuUsers(helperBody({ mobiles: [phone] }));
      setPhoneResult(
        (data.user_list ?? []).map((user) => ({
          open_id: user.user_id?.open_id ?? "",
          mobile: user.mobile,
          email: user.email,
        }))
      );
    } catch (error) {
      setPhoneError(messageOf(error));
    } finally {
      setPhoneLoading(false);
    }
  };

  const selectUser = (openId: string) => {
    props.onSelect(openId, "open_id");
    setMode("none");
  };

  // ---------- Listen ----------

  const stopPollingLocally = () => {
    clearPoll();
    setListenActive(false);
    setListenId(null);
  };

  const stopListener = async () => {
    clearPoll();
    setListenActive(false);
    const id = listenId();
    if (id) {
      try {
        await stopFeishuListen(id);
      } catch {
        // Best-effort stop, exactly like the old page.
      }
    }
    setListenId(null);
  };

  const startPolling = (id: string) => {
    clearPoll();
    pollTimer = setInterval(async () => {
      try {
        const data = await pollFeishuListen(id);
        if (data.status?.stopped) {
          stopPollingLocally();
        }
        setListenMessages(
          (data.messages ?? []).map((message) => ({
            open_id: message.sender?.open_id ?? "",
            name: message.sender?.name,
            message_id: message.message?.message_id ?? "",
            receivedAt: message.receivedAt ?? "",
          }))
        );
      } catch (error) {
        if (error instanceof NotificationApiError && error.status === 404) {
          stopPollingLocally();
        }
      }
    }, 2000);
  };

  const startListener = async () => {
    setMode("listen");
    setListenLoading(true);
    setListenError(null);
    setListenMessages([]);
    setListenId(null);
    setListenTtlSeconds(null);
    try {
      const status = await startFeishuListen(helperBody());
      const id = status.listenId;
      setListenId(id ?? null);
      setListenActive(!status.stopped);
      setListenTtlSeconds(status.ttlSeconds ?? null);
      if (id && !status.stopped) startPolling(id);
    } catch (error) {
      setListenError(messageOf(error));
    } finally {
      setListenLoading(false);
    }
  };

  const selectListenUser = (openId: string) => {
    props.onSelect(openId, "open_id");
    void stopListener();
    setMode("none");
  };

  const closeHelper = () => {
    if (listenActive()) void stopListener();
    setMode("none");
  };

  return (
    <section class="feishu-helper" aria-label="辅助获取 Receive ID">
      <div class="feishu-helper-title">
        <span>辅助获取 Receive ID</span>
        <Show when={!hasCredentials()}>
          <span class="feishu-helper-warning">
            (请先填写 App ID 和 App Secret)
          </span>
        </Show>
      </div>
      <div class="feishu-helper-actions">
        <button
          type="button"
          disabled={!hasCredentials() || chatsLoading()}
          title={
            hasCredentials()
              ? "列出机器人所在的群,选择后填入 chat_id"
              : "请先填写 App ID 和 App Secret"
          }
          onClick={() => void fetchChats()}
        >
          {chatsLoading() ? "加载中" : "从群列表选择"}
        </button>
        <button
          type="button"
          disabled={!hasCredentials()}
          title={
            hasCredentials()
              ? "输入手机号查询 open_id"
              : "请先填写 App ID 和 App Secret"
          }
          onClick={() => {
            setMode("phone");
            setPhoneResult(null);
            setPhoneError(null);
          }}
        >
          手机号查询
        </button>
        <button
          type="button"
          disabled={!hasCredentials() || listenLoading()}
          title={
            hasCredentials()
              ? listenActive()
                ? "停止监听"
                : "建立长连接,通过接收消息获取 open_id"
              : "请先填写 App ID 和 App Secret"
          }
          onClick={() =>
            void (listenActive() ? stopListener() : startListener())
          }
        >
          {listenLoading()
            ? "连接中"
            : listenActive()
              ? "停止监听"
              : "通过消息获取"}
        </button>
        <Show when={mode() !== "none"}>
          <button type="button" class="ghost" onClick={closeHelper}>
            关闭
          </button>
        </Show>
      </div>

      <Show when={mode() === "chats"}>
        <div class="feishu-helper-results">
          <Show when={chatsError()}>
            <p class="feishu-helper-error" role="alert">
              {chatsError()}
            </p>
          </Show>
          <Show when={chatsResult()}>
            {(result) => (
              <Show
                when={result().items.length > 0}
                fallback={
                  <p class="feishu-helper-empty">
                    机器人不在任何群中。请先将机器人添加到群聊。
                  </p>
                }
              >
                <ul class="feishu-picker">
                  <For each={result().items}>
                    {(chat) => (
                      <li>
                        <button
                          type="button"
                          class="feishu-picker-item"
                          onClick={() => selectChat(chat.chat_id)}
                        >
                          <span class="feishu-picker-name">
                            {chat.name || "(未命名群)"}
                          </span>
                          <span class="feishu-picker-id">{chat.chat_id}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={result().has_more}>
                  <button
                    type="button"
                    class="ghost"
                    disabled={chatsLoadingMore()}
                    onClick={() => void loadMoreChats()}
                  >
                    {chatsLoadingMore() ? "加载中" : "加载更多群..."}
                  </button>
                </Show>
              </Show>
            )}
          </Show>
        </div>
      </Show>

      <Show when={mode() === "phone"}>
        <div class="feishu-helper-results">
          <div class="feishu-lookup-row">
            <input
              aria-label="手机号"
              placeholder="+8613800138000"
              value={phoneInput()}
              onInput={(event) => setPhoneInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookupPhone();
                }
              }}
            />
            <button
              type="button"
              disabled={phoneLoading()}
              onClick={() => void lookupPhone()}
            >
              {phoneLoading() ? "查询中" : "查询"}
            </button>
          </div>
          <Show when={phoneError()}>
            <p class="feishu-helper-error" role="alert">
              {phoneError()}
            </p>
          </Show>
          <Show when={phoneResult()}>
            {(users) => (
              <Show
                when={users().length > 0}
                fallback={
                  <p class="feishu-helper-empty">
                    未找到匹配的用户。请检查手机号是否正确,并确保已开通
                    <code>
                      {findPermissionByScope("contact:user.id:readonly")
                        ?.scope ?? "contact:user.id:readonly"}
                    </code>
                    权限。
                  </p>
                }
              >
                <ul class="feishu-picker">
                  <For each={users()}>
                    {(user) => (
                      <li>
                        <button
                          type="button"
                          class="feishu-picker-item"
                          onClick={() => selectUser(user.open_id)}
                        >
                          <span class="feishu-picker-name">
                            {user.name || user.mobile || "未知用户"}
                          </span>
                          <span class="feishu-picker-id">
                            open_id: {user.open_id}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </div>
      </Show>

      <Show when={mode() === "listen"}>
        <div class="feishu-helper-results">
          <Show when={listenError()}>
            <p class="feishu-helper-error" role="alert">
              {listenError()}
            </p>
          </Show>
          <Show when={listenActive()}>
            <p class="feishu-helper-listening">
              正在监听...请给机器人发送任意消息(
              {listenTtlSeconds() !== null
                ? `${Math.round((listenTtlSeconds() ?? 0) / 60)}分钟`
                : "2分钟"}
              后自动停止)
            </p>
          </Show>
          <Show when={listenMessages().length > 0}>
            <ul class="feishu-picker">
              <For each={listenMessages()}>
                {(message, index) => (
                  <li>
                    <button
                      type="button"
                      class="feishu-picker-item"
                      onClick={() => selectListenUser(message.open_id)}
                    >
                      <span class="feishu-picker-name">
                        {message.name || "未知用户"}
                      </span>
                      <span class="feishu-picker-id">
                        open_id: {message.open_id}
                      </span>
                      <span class="feishu-picker-id">
                        {message.receivedAt
                          ? new Date(message.receivedAt).toLocaleTimeString(
                              "zh-CN"
                            )
                          : `消息 ${index() + 1}`}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show
            when={
              !listenActive() && listenMessages().length === 0 && !listenError()
            }
          >
            <p class="feishu-helper-empty">
              监听已停止。点击「通过消息获取」重新启动。
            </p>
          </Show>
        </div>
      </Show>
    </section>
  );
};
