// Port of components/ModelListDialog.tsx: the session-scoped model list dialog
// opened by the card's 模型 button (ADR-0015 — results live only for the
// session, never persisted, and never start a Query Cooldown).
//
// The component stays mounted (driven by the `open` prop) so its cache survives
// close/reopen; refetching only happens through the 刷新 button.

import { createEffect, createSignal, on, Show, type Component } from "solid-js";
import type { ModelsResult } from "../subscriptions/types";

interface ModelListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
}

function formatUpdateTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ModelListDialog: Component<ModelListDialogProps> = (props) => {
  const [models, setModels] = createSignal<string[] | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = createSignal<Date | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");

  const fetchModels = async (forceRefresh = false) => {
    // Cached models stay put unless the user explicitly refreshes.
    if (models() !== null && !forceRefresh) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${props.subscriptionId}/models`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "查询失败");
      }
      const data = (await res.json()) as ModelsResult;
      setModels(data.models);
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "查询失败");
    } finally {
      setLoading(false);
    }
  };

  // Fetch on first open only; reopening reuses the session cache.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open && models() === null && !loading()) {
          void fetchModels();
        }
      }
    )
  );

  const filteredModels = () => {
    const query = searchQuery().toLowerCase();
    return (models() ?? []).filter((model) =>
      model.toLowerCase().includes(query)
    );
  };

  const close = () => props.onOpenChange(false);

  return (
    <Show when={props.open}>
      <div class="dialog-backdrop">
        <div
          class="dialog model-list-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="模型列表"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <h2>模型列表</h2>
          <p class="dialog-description">
            当前订阅可用的模型列表（会话内缓存）
          </p>

          <div class="model-list-toolbar">
            <input
              type="search"
              placeholder="搜索模型..."
              value={searchQuery()}
              disabled={models() === null}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
            />
            <button
              type="button"
              class="ghost"
              onClick={() => void fetchModels(true)}
              disabled={loading()}
            >
              刷新
            </button>
          </div>

          <Show when={lastUpdatedAt()}>
            {(updatedAt) => (
              <p class="model-list-updated">
                更新于 {formatUpdateTime(updatedAt())}
              </p>
            )}
          </Show>

          <div class="model-list-body">
            <Show
              when={!error()}
              fallback={
                <div class="model-list-error">
                  <p>查询失败</p>
                  <p class="model-list-error-message">{error()}</p>
                </div>
              }
            >
              <Show
                when={!loading() || models() !== null}
                fallback={<p class="model-list-loading">加载中...</p>}
              >
                <Show
                  when={(models() ?? []).length > 0}
                  fallback={<p class="model-list-empty">未查询到模型</p>}
                >
                  <Show
                    when={filteredModels().length > 0 || !searchQuery()}
                    fallback={<p class="model-list-empty">未找到匹配的模型</p>}
                  >
                    <p class="model-list-count">
                      共 {models()?.length ?? 0} 个模型
                      <Show
                        when={
                          searchQuery() &&
                          filteredModels().length !== (models()?.length ?? 0)
                        }
                      >
                        {` · 显示 ${filteredModels().length} 个`}
                      </Show>
                    </p>
                    <ul class="model-list-items">
                      {(models() === null ? [] : filteredModels()).map(
                        (model) => (
                          <li class="model-list-item">{model}</li>
                        )
                      )}
                    </ul>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>

          <div class="form-actions">
            <button type="button" class="ghost" onClick={close}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
