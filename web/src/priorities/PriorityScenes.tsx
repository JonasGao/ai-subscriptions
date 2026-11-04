// Scene boards for the subscription and tool priority lists (#35), ported from
// components/PriorityManager.tsx / ToolPriorityManager.tsx and the old
// hooks/usePriorityScenes.ts data flow. Drag physics come from solid-dnd; the
// ordered id array is persisted with the same PATCH {action:"reorder"} contract
// the old hook used.

import { For, Show, createSignal, onMount, type Component, type JSX } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import type { SceneClient } from "./api";

interface SceneBase {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SceneItem {
  id: string;
  name: string;
}

export interface PriorityScenesProps<T extends SceneBase> {
  client: SceneClient<T>;
  /** orderOf reads the scene's ordered item ids (subscriptionOrder/toolOrder). */
  orderOf: (scene: T) => string[];
  items: SceneItem[];
  addLabel: string;
  emptyLabel: string;
  renderList: (order: string[], onRemove: (id: string) => void) => JSX.Element;
}

/**
 * PriorityScenes is the shared scene board: create/rename/delete scenes, add
 * and remove items, and persist drag reordering.
 */
export function PriorityScenes<T extends SceneBase>(
  props: PriorityScenesProps<T>
): JSX.Element {
  const [scenes, setScenes] = createSignal<T[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [editingId, setEditingId] = createSignal("");
  const [editingName, setEditingName] = createSignal("");

  const message = (value: unknown, fallback: string) =>
    value instanceof Error ? value.message : fallback;

  const load = async () => {
    try {
      setScenes(await props.client.list());
    } catch (loadError) {
      setError(message(loadError, "加载优先级场景失败"));
    } finally {
      setLoading(false);
    }
  };

  onMount(load);

  const replaceScene = (scene: T) =>
    setScenes((previous) =>
      previous.map((item) => (item.id === scene.id ? scene : item))
    );

  const createScene = async () => {
    const name = newName().trim();
    if (!name) return;
    try {
      const created = await props.client.create(name);
      setScenes((previous) => [...previous, created]);
      setNewName("");
      setCreating(false);
      setError(null);
    } catch (createError) {
      setError(message(createError, "创建场景失败"));
    }
  };

  const renameScene = async (scene: T) => {
    const name = editingName().trim();
    if (!name) return;
    try {
      replaceScene(await props.client.rename(scene.id, name));
      setEditingId("");
      setEditingName("");
      setError(null);
    } catch (renameError) {
      setError(message(renameError, "重命名场景失败"));
    }
  };

  const deleteScene = async (scene: T) => {
    if (typeof window !== "undefined" && !window.confirm("确定要删除该场景吗？")) {
      return;
    }
    try {
      await props.client.remove(scene.id);
      setScenes((previous) => previous.filter((item) => item.id !== scene.id));
      setError(null);
    } catch (deleteError) {
      setError(message(deleteError, "删除场景失败"));
    }
  };

  const persistOrder = async (scene: T, order: string[]) => {
    try {
      replaceScene(await props.client.reorder(scene.id, order));
      setError(null);
    } catch (reorderError) {
      setError(message(reorderError, "保存排序失败"));
      await load();
    }
  };

  const removeItem = (scene: T, itemId: string) => {
    const order = props.orderOf(scene).filter((id) => id !== itemId);
    void persistOrder(scene, order);
  };

  const addItem = (scene: T, itemId: string) => {
    if (!itemId) return;
    const order = props.orderOf(scene);
    if (order.includes(itemId)) return;
    void persistOrder(scene, [...order, itemId]);
  };

  const handleDragEnd = (scene: T, event: DragEvent) => {
    const { draggable, droppable } = event;
    if (!droppable || draggable.id === droppable.id) return;
    const order = [...props.orderOf(scene)];
    const from = order.indexOf(String(draggable.id));
    const to = order.indexOf(String(droppable.id));
    if (from === -1 || to === -1) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void persistOrder(scene, order);
  };

  const availableItems = (scene: T) =>
    props.items.filter((item) => !props.orderOf(scene).includes(item.id));

  return (
    <section class="priority-scenes">
      <Show when={error()}>
        <p class="form-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!loading()} fallback={<p class="loading">加载中...</p>}>
        <div class="scene-grid">
          <For each={scenes()}>
            {(scene) => (
              <article class="scene-card">
                <header class="scene-header">
                  <Show
                    when={editingId() === scene.id}
                    fallback={
                      <>
                        <h3>{scene.name}</h3>
                        <div class="scene-actions">
                          <button
                            type="button"
                            class="ghost"
                            onClick={() => {
                              setEditingId(scene.id);
                              setEditingName(scene.name);
                            }}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            class="ghost danger"
                            onClick={() => void deleteScene(scene)}
                          >
                            删除
                          </button>
                        </div>
                      </>
                    }
                  >
                    <input
                      aria-label="场景名称"
                      value={editingName()}
                      onInput={(event) => setEditingName(event.currentTarget.value)}
                    />
                    <div class="scene-actions">
                      <button
                        type="button"
                        onClick={() => void renameScene(scene)}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        class="ghost"
                        onClick={() => setEditingId("")}
                      >
                        取消
                      </button>
                    </div>
                  </Show>
                </header>

                <DragDropProvider
                  collisionDetector={closestCenter}
                  onDragEnd={(event) => handleDragEnd(scene, event)}
                >
                  <DragDropSensors />
                  <SortableProvider ids={props.orderOf(scene)}>
                    <div class="scene-list">
                      {props.renderList(props.orderOf(scene), (itemId) =>
                        removeItem(scene, itemId)
                      )}
                    </div>
                  </SortableProvider>
                </DragDropProvider>

                <div class="scene-add">
                  <select
                    aria-label={`添加${props.addLabel}`}
                    value=""
                    onChange={(event) => {
                      addItem(scene, event.currentTarget.value);
                      event.currentTarget.value = "";
                    }}
                  >
                    <option value="">添加{props.addLabel}…</option>
                    <For each={availableItems(scene)}>
                      {(item) => <option value={item.id}>{item.name}</option>}
                    </For>
                  </select>
                  <Show when={props.orderOf(scene).length === 0}>
                    <p class="scene-empty">{props.emptyLabel}</p>
                  </Show>
                </div>
              </article>
            )}
          </For>
        </div>

        <Show
          when={creating()}
          fallback={
            <button
              type="button"
              class="ghost"
              onClick={() => setCreating(true)}
            >
              创建新场景
            </button>
          }
        >
          <div class="scene-create">
            <input
              aria-label="新场景名称"
              placeholder="场景名称"
              value={newName()}
              onInput={(event) => setNewName(event.currentTarget.value)}
            />
            <button type="button" onClick={() => void createScene()}>
              创建
            </button>
            <button
              type="button"
              class="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              取消
            </button>
          </div>
        </Show>
      </Show>
    </section>
  );
}
