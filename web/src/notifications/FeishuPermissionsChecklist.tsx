// Solid port of components/FeishuPermissionsChecklist.tsx (#44). Collapsible
// list of the scopes the feishu-app channel needs, with a deep link into the
// Feishu developer console when an appId is known.

import { For, Show, createSignal, type Component } from "solid-js";
import {
  FEISHU_LISTEN_EVENT_KEY,
  FEISHU_OPEN_PLATFORM_APP_URL,
  FEISHU_OPEN_PLATFORM_ROOT,
  FEISHU_PERMISSIONS,
  FEISHU_WEBSOCKET_EVENT_HINT,
} from "./permissions";

export interface FeishuPermissionsChecklistProps {
  appId: string;
}

export const FeishuPermissionsChecklist: Component<
  FeishuPermissionsChecklistProps
> = (props) => {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="feishu-permissions">
      <button
        type="button"
        class="feishu-permissions-toggle"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          所需飞书权限清单
          <span class="feishu-permissions-count">
            {FEISHU_PERMISSIONS.length}
          </span>
        </span>
        <span classList={{ "feishu-permissions-chevron": true, open: open() }}>
          ▾
        </span>
      </button>
      <Show when={open()}>
        <div class="feishu-permissions-body">
          <p class="feishu-permissions-hint">
            请在飞书开放平台后台为应用开通以下权限,否则发消息 / 辅助获取 /
            长连接监听会报错。
          </p>
          <ul class="feishu-permissions-list">
            <For each={FEISHU_PERMISSIONS}>
              {(permission) => (
                <li>
                  <div class="feishu-permission-head">
                    <code>{permission.scope}</code>
                    <span>{permission.name}</span>
                  </div>
                  <p class="feishu-permission-purpose">{permission.purpose}</p>
                  <div class="feishu-permission-used-by">
                    <span>用于:</span>
                    <For each={permission.usedBy}>
                      {(usedBy) => (
                        <span class="feishu-permission-tag">{usedBy}</span>
                      )}
                    </For>
                  </div>
                </li>
              )}
            </For>
          </ul>
          <div class="feishu-permissions-hintbox">
            <p>{FEISHU_WEBSOCKET_EVENT_HINT}</p>
            <p class="feishu-permissions-event">
              事件 key: <code>{FEISHU_LISTEN_EVENT_KEY}</code>
            </p>
          </div>
          <Show
            when={props.appId.trim()}
            fallback={
              <a
                class="feishu-permissions-link"
                href={FEISHU_OPEN_PLATFORM_ROOT}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开飞书开放平台后台
              </a>
            }
          >
            <a
              class="feishu-permissions-link"
              href={FEISHU_OPEN_PLATFORM_APP_URL.replace(
                "{appId}",
                props.appId.trim()
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开飞书开放平台权限页 (应用 {props.appId.trim()})
            </a>
          </Show>
        </div>
      </Show>
    </div>
  );
};
