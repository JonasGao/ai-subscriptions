// Solid port of components/ToolList.tsx (#35): the sortable tool cards with
// status cycling, edit and delete, plus drag reordering through solid-dnd.

import { For, Show, type Component } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import type { Tool } from "../priorities/types";
import { useSortableRow } from "../priorities/dnd";

const STATUS_CONFIG: Record<
  Tool["status"],
  { label: string; next: Tool["status"] }
> = {
  active: { label: "活跃", next: "paused" },
  paused: { label: "暂停", next: "cancelled" },
  cancelled: { label: "已取消", next: "active" },
};

function providerName(tool: Tool): string {
  if (tool.provider === "other" && tool.providerCustom) {
    return tool.providerCustom;
  }
  return tool.provider;
}

const ToolCard: Component<{
  tool: Tool;
  onEdit: (tool: Tool) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: Tool["status"]) => void;
}> = (props) => {
  const sortable = useSortableRow(props.tool.id);
  return (
    <article
      ref={sortable.ref}
      class="tool-card"
      style={{ ...sortable.style(), opacity: sortable.isActive() ? 0.5 : 1 }}
    >
      <div class="tool-card-main">
        <button
          type="button"
          class="priority-drag-handle"
          aria-label="拖拽排序"
          {...sortable.attrs}
          ref={sortable.attach}
        >
          ⋮⋮
        </button>
        <h3>{props.tool.name}</h3>
        <button
          type="button"
          class={`priority-badge priority-badge-${props.tool.status}`}
          title={`点击切换为 ${STATUS_CONFIG[STATUS_CONFIG[props.tool.status].next].label}`}
          onClick={() =>
            props.onStatusChange(
              props.tool.id,
              STATUS_CONFIG[props.tool.status].next
            )
          }
        >
          {STATUS_CONFIG[props.tool.status].label}
        </button>
        <div class="tool-card-actions">
          <button type="button" class="ghost" onClick={() => props.onEdit(props.tool)}>
            编辑
          </button>
          <button
            type="button"
            class="ghost danger"
            onClick={() => props.onDelete(props.tool.id)}
          >
            删除
          </button>
        </div>
      </div>
      <div class="tool-card-meta">
        <span>分类: {props.tool.category}</span>
        <span>提供商: {providerName(props.tool)}</span>
        <Show when={props.tool.forms.length > 0}>
          <span>形式: {props.tool.forms.join(" / ")}</span>
        </Show>
        <Show when={props.tool.isOpenSource}>
          <span class="tool-open-source">开源</span>
          <Show when={props.tool.repoUrl}>
            <a href={props.tool.repoUrl} target="_blank" rel="noopener noreferrer">
              仓库
            </a>
          </Show>
        </Show>
        <Show when={props.tool.notes}>
          <span>备注: {props.tool.notes}</span>
        </Show>
      </div>
    </article>
  );
};

export interface ToolListProps {
  tools: Tool[];
  onEdit: (tool: Tool) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: Tool["status"]) => void;
  onReorder: (toolIds: string[]) => void;
}

export const ToolList: Component<ToolListProps> = (props) => {
  const sortedTools = () =>
    [...props.tools].sort((a, b) => a.order - b.order);

  const handleDragEnd = (event: DragEvent) => {
    const { draggable, droppable } = event;
    if (!droppable || draggable.id === droppable.id) return;
    const tools = sortedTools();
    const from = tools.findIndex((tool) => tool.id === String(draggable.id));
    const to = tools.findIndex((tool) => tool.id === String(droppable.id));
    if (from === -1 || to === -1) return;
    const reordered = [...tools];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    props.onReorder(reordered.map((tool) => tool.id));
  };

  return (
    <Show
      when={sortedTools().length > 0}
      fallback={
        <p class="empty-state">暂无工具，点击「添加工具」开始记录。</p>
      }
    >
      <DragDropProvider
        collisionDetector={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <DragDropSensors />
        <SortableProvider ids={sortedTools().map((tool) => tool.id)}>
          <div class="tool-list">
            <For each={sortedTools()}>
              {(tool) => (
                <ToolCard
                  tool={tool}
                  onEdit={props.onEdit}
                  onDelete={props.onDelete}
                  onStatusChange={props.onStatusChange}
                />
              )}
            </For>
          </div>
        </SortableProvider>
      </DragDropProvider>
    </Show>
  );
};
