// Solid port of components/SortablePriorityList.tsx (#35): the subscription
// priority rows with rank numbering, the priority colour ramp and the
// exhausted-scope labels. Drag physics live in ./dnd; the scene wiring lives in
// ./PriorityScenes.

import { For, Show, type Component } from "solid-js";
import { useSortableRow } from "./dnd";
import type { ResetSchedule, Subscription } from "../subscriptions/types";

const EXHAUSTED_SCOPE_PRIORITY: Record<ResetSchedule["type"], number> = {
  fiveHour: 0,
  weekly: 1,
  monthly: 2,
};

const EXHAUSTED_SCOPE_LABEL: Record<ResetSchedule["type"], string> = {
  fiveHour: "5小时",
  weekly: "周",
  monthly: "月度",
};

const STATUS_LABEL: Record<Subscription["status"], string> = {
  active: "活跃",
  paused: "暂停",
  cancelled: "已取消",
};

/** getExhaustedScopeLabel picks the largest exhausted reset scope, if any. */
export function getExhaustedScopeLabel(
  subscription: Subscription
): string | null {
  if (subscription.status === "cancelled") {
    return null;
  }
  const schedules = subscription.resetSchedules ?? [];
  let best: ResetSchedule["type"] | null = null;
  for (const schedule of schedules) {
    if (!schedule.enabled || !schedule.exhausted) continue;
    if (
      best === null ||
      EXHAUSTED_SCOPE_PRIORITY[schedule.type] > EXHAUSTED_SCOPE_PRIORITY[best]
    ) {
      best = schedule.type;
    }
  }
  if (best === null) return null;
  return EXHAUSTED_SCOPE_LABEL[best];
}

/** getPriorityOpacity fades from strongest at rank 1 to weakest at the tail. */
export function getPriorityOpacity(
  rank: number,
  total: number,
  strongest: number,
  weakest: number
): string {
  if (total <= 1) {
    return strongest.toFixed(2);
  }
  const progress = (rank - 1) / (total - 1);
  return (strongest + (weakest - strongest) * progress).toFixed(2);
}

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

interface PriorityRowProps {
  subscription: Subscription;
  rank: number;
  total: number;
  onRemove: (id: string) => void;
}

const PriorityRow: Component<PriorityRowProps> = (props) => {
  const sortable = useSortableRow(props.subscription.id);
  const exhaustedScope = () => getExhaustedScopeLabel(props.subscription);

  const rowStyle = () => ({
    ...sortable.style(),
    opacity: sortable.isActive() ? 0.5 : 1,
    "--priority-bg-opacity-light": getPriorityOpacity(
      props.rank,
      props.total,
      0.18,
      0.05
    ),
    "--priority-border-opacity-light": getPriorityOpacity(
      props.rank,
      props.total,
      0.42,
      0.18
    ),
    "--priority-bg-opacity-dark": getPriorityOpacity(
      props.rank,
      props.total,
      0.26,
      0.08
    ),
    "--priority-border-opacity-dark": getPriorityOpacity(
      props.rank,
      props.total,
      0.56,
      0.24
    ),
  });

  return (
    <div
      ref={sortable.ref}
      style={rowStyle()}
      data-priority-rank={props.rank}
      class="priority-row"
      classList={{ "priority-row-dragging": sortable.isActive() }}
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

      <span
        aria-label={`优先级 ${props.rank}`}
        class="priority-rank"
      >
        {props.rank}
      </span>

      <span class="priority-name">{props.subscription.name}</span>

      <Show when={exhaustedScope()}>
        {(label) => (
          <span
            aria-label={`额度用尽范围：${label()}`}
            class="priority-scope text-red-500"
          >
            {label()}
          </span>
        )}
      </Show>

      <span
        class={`priority-badge priority-badge-${props.subscription.status}`}
      >
        {STATUS_LABEL[props.subscription.status]}
      </span>

      <button
        type="button"
        class="priority-remove"
        aria-label={`移除 ${props.subscription.name}`}
        onClick={() => props.onRemove(props.subscription.id)}
      >
        ×
      </button>
    </div>
  );
};

export interface SortablePriorityListProps {
  subscriptionOrder: string[];
  subscriptions: Subscription[];
  onRemove: (subscriptionId: string) => void;
}

export const SortablePriorityList: Component<SortablePriorityListProps> = (
  props
) => {
  const orderedSubscriptions = () =>
    props.subscriptionOrder
      .map((id) => props.subscriptions.find((subscription) => subscription.id === id))
      .filter((subscription): subscription is Subscription => Boolean(subscription));

  return (
    <Show
      when={orderedSubscriptions().length > 0}
      fallback={
        <div class="priority-empty">
          该场景暂无订阅，请从下方列表添加
        </div>
      }
    >
      <div class="priority-list">
        <For each={orderedSubscriptions()}>
          {(subscription, index) => (
            <PriorityRow
              subscription={subscription}
              rank={index() + 1}
              total={orderedSubscriptions().length}
              onRemove={props.onRemove}
            />
          )}
        </For>
      </div>
    </Show>
  );
};
