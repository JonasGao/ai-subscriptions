// Channel create/edit dialog (#44), ported from the Dialog in
// app/notifications/page.tsx. Validation mirrors the old submitForm exactly;
// helper panels own their own API calls and polling.

import { Show, createEffect, createSignal, type Component } from "solid-js";
import { createDialogFocus } from "../lib/dialogFocus";
import {
  CHANNEL_TYPE_LABELS,
  EMPTY_CHANNEL_FORM,
  isFeishuAppType,
  type ChannelFormState,
  type ChannelPayload,
  type ChannelView,
  type FeishuReceiveIdType,
  type NotificationChannelType,
} from "./types";
import { FeishuPermissionsChecklist } from "./FeishuPermissionsChecklist";
import { FeishuHelperPanel } from "./FeishuHelperPanel";

export interface ChannelFormDialogProps {
  open: boolean;
  channel: ChannelView | null;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string | null, payload: ChannelPayload) => Promise<void>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const ChannelFormDialog: Component<ChannelFormDialogProps> = (props) => {
  const [form, setForm] = createSignal<ChannelFormState>({
    ...EMPTY_CHANNEL_FORM,
  });
  const [formError, setFormError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    const channel = props.channel;
    setForm(
      channel
        ? {
            name: channel.name,
            type: channel.type,
            url: channel.url ?? "",
            secret: "",
            enabled: channel.enabled,
            clearSecret: false,
            appId: channel.appId ?? "",
            appSecret: "",
            receiveId: channel.receiveId ?? "",
            receiveIdType: channel.receiveIdType ?? "open_id",
            clearAppSecret: false,
          }
        : { ...EMPTY_CHANNEL_FORM }
    );
    setFormError(null);
    setSubmitting(false);
  });

  const patch = (values: Partial<ChannelFormState>) =>
    setForm((previous) => ({ ...previous, ...values }));

  const buildPayload = (data: ChannelFormState): ChannelPayload => {
    const isFeishuApp = isFeishuAppType(data.type);
    const payload: ChannelPayload = {
      name: data.name.trim(),
      type: data.type,
      enabled: data.enabled,
    };

    if (isFeishuApp) {
      payload.appId = data.appId.trim();
      payload.receiveId = data.receiveId.trim();
      payload.receiveIdType = data.receiveIdType;
    } else {
      payload.url = data.url.trim();
    }

    if (props.channel) {
      // On edit, only touch the secret when the user typed a new one or asked
      // to clear it. Sending null clears; sending a string replaces.
      if (isFeishuApp) {
        if (data.clearAppSecret) payload.appSecret = null;
        else if (data.appSecret.length > 0) payload.appSecret = data.appSecret;
      } else if (data.clearSecret) {
        payload.secret = null;
      } else if (data.secret.length > 0) {
        payload.secret = data.secret;
      }
    } else if (isFeishuApp) {
      if (data.appSecret.length > 0) payload.appSecret = data.appSecret;
    } else if (data.secret.length > 0) {
      payload.secret = data.secret;
    }

    return payload;
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setFormError(null);
    const data = form();

    if (!data.name.trim()) {
      setFormError("请填写渠道名称");
      return;
    }

    if (isFeishuAppType(data.type)) {
      if (!data.appId.trim()) {
        setFormError("请填写 App ID");
        return;
      }
      if (!props.channel && !data.appSecret.trim()) {
        setFormError("请填写 App Secret");
        return;
      }
      if (!data.receiveId.trim()) {
        setFormError("请填写 Receive ID");
        return;
      }
      if (
        data.receiveIdType !== "open_id" &&
        data.receiveIdType !== "chat_id"
      ) {
        setFormError("Receive ID 类型必须是 open_id 或 chat_id");
        return;
      }
    } else {
      if (!data.url.trim()) {
        setFormError("请填写 webhook URL");
        return;
      }
      try {
        new URL(data.url.trim());
      } catch {
        setFormError("webhook URL 格式不正确");
        return;
      }
    }

    setSubmitting(true);
    try {
      await props.onSave(props.channel?.id ?? null, buildPayload(data));
      props.onOpenChange(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const hasStoredAppSecret = () => Boolean(props.channel?.hasAppSecret);
  const hasStoredSecret = () => Boolean(props.channel?.hasSecret);

  const dialogFocus = createDialogFocus(() => props.onOpenChange(false));

  return (
    <Show when={props.open}>
      <div class="dialog-backdrop" role="presentation">
        <div
          class="dialog notifications-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={props.channel ? "编辑渠道" : "添加渠道"}
          tabindex="-1"
          ref={dialogFocus.ref}
          onKeyDown={dialogFocus.onKeyDown}
        >
          <h2>{props.channel ? "编辑渠道" : "添加渠道"}</h2>
          <p class="notifications-dialog-description">
            {props.channel
              ? "修改渠道配置。密钥留空表示保持不变，勾选「清除」以移除。"
              : "添加一个新的通知渠道（钉钉 / 飞书 / 飞书应用 / 通用 webhook）。"}
          </p>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div class="form-grid">
              <label for="channel-name">
                <span>名称 *</span>
                <input
                  id="channel-name"
                  value={form().name}
                  maxlength={100}
                  placeholder="例如：值班钉钉群"
                  autocomplete="off"
                  onInput={(event) =>
                    patch({ name: event.currentTarget.value })
                  }
                />
              </label>

              <label for="channel-type">
                <span>类型</span>
                <select
                  id="channel-type"
                  value={form().type}
                  onChange={(event) =>
                    patch({
                      type: event.currentTarget
                        .value as NotificationChannelType,
                    })
                  }
                >
                  <option value="dingtalk">
                    {CHANNEL_TYPE_LABELS.dingtalk}
                  </option>
                  <option value="feishu">飞书群机器人</option>
                  <option value="feishu-app">飞书应用机器人</option>
                  <option value="webhook">{CHANNEL_TYPE_LABELS.webhook}</option>
                </select>
              </label>

              <Show when={isFeishuAppType(form().type)}>
                <label for="channel-app-id">
                  <span>App ID *</span>
                  <input
                    id="channel-app-id"
                    value={form().appId}
                    placeholder="飞书应用 App ID"
                    autocomplete="off"
                    onInput={(event) =>
                      patch({ appId: event.currentTarget.value })
                    }
                  />
                </label>

                <label for="channel-app-secret">
                  <span>App Secret{props.channel ? "" : " *"}</span>
                  <input
                    id="channel-app-secret"
                    type="password"
                    value={form().appSecret}
                    placeholder={
                      hasStoredAppSecret()
                        ? "••••••••（留空保持不变）"
                        : "飞书应用 App Secret"
                    }
                    autocomplete="off"
                    onInput={(event) =>
                      patch({ appSecret: event.currentTarget.value })
                    }
                  />
                </label>

                <Show when={hasStoredAppSecret()}>
                  <label
                    class="checkbox-chip form-field-wide"
                    for="channel-clear-app-secret"
                  >
                    <input
                      id="channel-clear-app-secret"
                      type="checkbox"
                      checked={form().clearAppSecret}
                      onChange={(event) =>
                        patch({
                          clearAppSecret: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>清除已配置的 App Secret</span>
                  </label>
                </Show>

                <label for="channel-receive-id-type">
                  <span>接收类型</span>
                  <select
                    id="channel-receive-id-type"
                    value={form().receiveIdType}
                    onChange={(event) =>
                      patch({
                        receiveIdType: event.currentTarget
                          .value as FeishuReceiveIdType,
                      })
                    }
                  >
                    <option value="open_id">单聊 (open_id)</option>
                    <option value="chat_id">群聊 (chat_id)</option>
                  </select>
                </label>

                <label for="channel-receive-id">
                  <span>Receive ID *</span>
                  <input
                    id="channel-receive-id"
                    value={form().receiveId}
                    placeholder={
                      form().receiveIdType === "open_id"
                        ? "用户 open_id"
                        : "群组 chat_id"
                    }
                    autocomplete="off"
                    onInput={(event) =>
                      patch({ receiveId: event.currentTarget.value })
                    }
                  />
                </label>

                <div class="form-field-wide">
                  <FeishuPermissionsChecklist appId={form().appId} />
                </div>

                <div class="form-field-wide">
                  <FeishuHelperPanel
                    appId={form().appId}
                    appSecret={form().appSecret}
                    channelId={props.channel?.id ?? null}
                    hasStoredSecret={hasStoredAppSecret()}
                    onSelect={(receiveId, receiveIdType) =>
                      patch({ receiveId, receiveIdType })
                    }
                  />
                </div>
              </Show>

              <Show when={!isFeishuAppType(form().type)}>
                <label class="form-field-wide" for="channel-url">
                  <span>Webhook URL *</span>
                  <input
                    id="channel-url"
                    value={form().url}
                    placeholder="https://..."
                    autocomplete="off"
                    onInput={(event) =>
                      patch({ url: event.currentTarget.value })
                    }
                  />
                </label>

                <label class="form-field-wide" for="channel-secret">
                  <span>加签 Secret（可选）</span>
                  <input
                    id="channel-secret"
                    type="password"
                    value={form().secret}
                    placeholder={
                      hasStoredSecret()
                        ? "••••••••（留空保持不变）"
                        : "选填，用于 HMAC 加签"
                    }
                    autocomplete="off"
                    onInput={(event) =>
                      patch({ secret: event.currentTarget.value })
                    }
                  />
                </label>

                <Show when={hasStoredSecret()}>
                  <label
                    class="checkbox-chip form-field-wide"
                    for="channel-clear-secret"
                  >
                    <input
                      id="channel-clear-secret"
                      type="checkbox"
                      checked={form().clearSecret}
                      onChange={(event) =>
                        patch({ clearSecret: event.currentTarget.checked })
                      }
                    />
                    <span>清除已配置的签名</span>
                  </label>
                </Show>
              </Show>

              <label
                class="checkbox-chip form-field-wide"
                for="channel-enabled"
              >
                <input
                  id="channel-enabled"
                  type="checkbox"
                  checked={form().enabled}
                  onChange={(event) =>
                    patch({ enabled: event.currentTarget.checked })
                  }
                />
                <span>启用此渠道</span>
              </label>

              <Show when={formError()}>
                <p class="form-error form-field-wide" role="alert">
                  {formError()}
                </p>
              </Show>
            </div>

            <div class="form-actions">
              <button
                type="button"
                class="ghost"
                disabled={submitting()}
                onClick={() => props.onOpenChange(false)}
              >
                取消
              </button>
              <button type="submit" disabled={submitting()}>
                {submitting() ? "保存中" : "保存"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
