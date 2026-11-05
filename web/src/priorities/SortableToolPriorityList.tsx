// Solid port of components/SortableToolPriorityList.tsx (#35): the tool-side
// priority rows. Same drag seam as the subscription list, no rank colour ramp.

import { For, Show, type Component } from "solid-js";
import { useSortableRow } from "./dnd";
import type { Tool } from "./types";
import { CloseIcon, DragIcon } from "../components/icons.tsx";

const GripIcon: Component = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  </svg>
);

const STATUS_LABEL: Record<Tool["status"], string> = {
  active: "活跃",
  paused: "暂停",
  cancelled: "已取消",
};

const ToolRow: Component<{
  tool: Tool;
  onRemove: (id: string) => void;
}> = (props) => {
  const sortable = useSortableRow(props.tool.id);
  return (
    <div
      ref={sortable.ref}
      style={{ ...sortable.style(), opacity: sortable.isActive() ? 0.5 : 1 }}
      class="priority-row"
    >
      <button
        type="button"
        class="priority-drag-handle"
        aria-label="拖拽排序"
        {...sortable.attrs}
        ref={sortable.attach}
      >
        <GripIcon />
      </button>
      <span class="priority-name">{props.tool.name}</span>
      <span class={`priority-badge priority-badge-${props.tool.status}`}>
        {STATUS_LABEL[props.tool.status]}
      </span>
      <button
        type="button"
        class="priority-remove"
        aria-label={`移除 ${props.tool.name}`}
        onClick={() => props.onRemove(props.tool.id)}
      >
        <CloseIcon />
      </button>
    </div>
  );
};

export interface SortableToolPriorityListProps {
  toolOrder: string[];
  tools: Tool[];
  onRemove: (toolId: string) => void;
}

export const SortableToolPriorityList: Component<
  SortableToolPriorityListProps
> = (props) => {
  const orderedTools = () =>
    props.toolOrder
      .map((id) => props.tools.find((tool) => tool.id === id))
      .filter((tool): tool is Tool => Boolean(tool));

  return (
    <Show
      when={orderedTools().length > 0}
      fallback={
        <div class="priority-empty">该场景暂无工具，请从下方列表添加</div>
      }
    >
      <div class="priority-list">
        <For each={orderedTools()}>
          {(tool) => <ToolRow tool={tool} onRemove={props.onRemove} />}
        </For>
      </div>
    </Show>
  );
};
