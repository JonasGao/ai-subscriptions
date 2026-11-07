import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { createDialogFocus } from "../lib/dialogFocus";
import type { ProxySubscription, ProxySubscriptionTag } from "./api";
import { getTagNameError } from "./TagInput";

// SolidJS port of components/ProxyTagManagerDialog.tsx: rename/delete the
// proxy-only tag catalog. Proxy tags are independent from AI subscription tags
// (ADR-0009), so this dialog never touches the AI tag surface.

export interface ProxyTagManagerDialogProps {
  tags: ProxySubscriptionTag[];
  subscriptions: ProxySubscription[];
  onRename: (id: string, name: string) => Promise<ProxySubscriptionTag>;
  onDelete: (id: string) => Promise<void>;
}

export const ProxyTagManagerDialog: Component<ProxyTagManagerDialogProps> = (
  props
) => {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingName, setEditingName] = createSignal("");
  const [pendingDelete, setPendingDelete] =
    createSignal<ProxySubscriptionTag | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const counts = createMemo(() => {
    const result = new Map<string, number>();
    for (const subscription of props.subscriptions) {
      for (const id of subscription.tagIds ?? []) {
        result.set(id, (result.get(id) ?? 0) + 1);
      }
    }
    return result;
  });

  const visibleTags = createMemo(() =>
    props.tags.filter((tag) =>
      tag.name.toLocaleLowerCase().includes(search().trim().toLocaleLowerCase())
    )
  );

  const saveRename = async (tag: ProxySubscriptionTag) => {
    const name = editingName().trim();
    const validationError = getTagNameError(name);
    if (validationError) return setError(validationError);
    if (props.tags.some((item) => item.id !== tag.id && item.name === name)) {
      return setError("标签名称已存在");
    }
    try {
      await props.onRename(tag.id, name);
      setEditingId(null);
      setError(null);
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : "重命名失败"
      );
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete();
    if (!target) return;
    try {
      await props.onDelete(target.id);
      setPendingDelete(null);
      setError(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "删除标签失败"
      );
    }
  };

  const dialogFocus = createDialogFocus(() => setOpen(false));
  const deleteDialogFocus = createDialogFocus(() => setPendingDelete(null));

  return (
    <>
      <button
        type="button"
        title="管理代理标签"
        aria-label="管理代理标签"
        onClick={() => setOpen(true)}
      >
        管理标签
      </button>

      <Show when={open()}>
        <div class="proxy-dialog-backdrop" role="presentation">
          <div
            class="proxy-dialog"
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            ref={dialogFocus.ref}
            onKeyDown={dialogFocus.onKeyDown}
          >
            <header class="proxy-dialog-header">
              <h2>管理代理标签</h2>
              <p class="tagline">重命名或删除代理订阅标签。</p>
            </header>
            <label class="proxy-field" for="proxy-tag-search">
              <span>搜索标签</span>
              <input
                id="proxy-tag-search"
                value={search()}
                placeholder="搜索标签"
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
            </label>

            <Show when={error()}>
              <p class="auth-error" role="alert">
                {error()}
              </p>
            </Show>

            <ul class="proxy-tag-manager-list">
              <For each={visibleTags()}>
                {(tag) => (
                  <li>
                    <Show
                      when={editingId() === tag.id}
                      fallback={
                        <>
                          <div class="proxy-tag-manager-name">
                            <strong>{tag.name}</strong>
                            <span>
                              {counts().get(tag.id) ?? 0} 个代理订阅使用
                            </span>
                          </div>
                          <button
                            type="button"
                            title={`重命名 ${tag.name}`}
                            onClick={() => {
                              setEditingId(tag.id);
                              setEditingName(tag.name);
                              setError(null);
                            }}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            class="danger"
                            title={`删除 ${tag.name}`}
                            onClick={() => setPendingDelete(tag)}
                          >
                            删除
                          </button>
                        </>
                      }
                    >
                      <input
                        class="proxy-tag-manager-edit"
                        value={editingName()}
                        autofocus
                        onInput={(event) =>
                          setEditingName(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveRename(tag);
                          }
                          if (event.key === "Escape") setEditingId(null);
                        }}
                      />
                      <button
                        type="button"
                        title="保存名称"
                        onClick={() => void saveRename(tag)}
                      >
                        保存
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </Show>
                  </li>
                )}
              </For>
              <Show when={visibleTags().length === 0}>
                <li class="proxy-empty">暂无代理标签</li>
              </Show>
            </ul>

            <footer class="proxy-dialog-footer">
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </footer>
          </div>
        </div>
      </Show>

      <Show when={pendingDelete()}>
        {(target) => (
          <div class="proxy-dialog-backdrop" role="presentation">
            <div
              class="proxy-dialog"
              role="dialog"
              aria-modal="true"
              tabindex="-1"
              ref={deleteDialogFocus.ref}
              onKeyDown={deleteDialogFocus.onKeyDown}
            >
              <header class="proxy-dialog-header">
                <h2>删除代理标签？</h2>
                <p class="tagline">删除后会从所有代理订阅中移除该标签。</p>
              </header>
              <p>
                标签「{target().name}」将从 {counts().get(target().id) ?? 0}{" "}
                个代理订阅中移除。
              </p>
              <footer class="proxy-dialog-footer">
                <button type="button" onClick={() => setPendingDelete(null)}>
                  取消
                </button>
                <button
                  type="button"
                  class="danger"
                  onClick={() => void confirmDelete()}
                >
                  删除
                </button>
              </footer>
            </div>
          </div>
        )}
      </Show>
    </>
  );
};
