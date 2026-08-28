"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ResetSchedule, Subscription } from "@/lib/types";
import type { CSSProperties } from "react";

interface SortableItemProps {
  id: string;
  subscription: Subscription;
  onRemove: (id: string) => void;
  rank: number;
  total: number;
}

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

function getExhaustedScopeLabel(subscription: Subscription): string | null {
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

function getPriorityOpacity(
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

function SortableItem({
  id,
  subscription,
  onRemove,
  rank,
  total,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const exhaustedScopeLabel = getExhaustedScopeLabel(subscription);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    "--priority-bg-opacity-light": getPriorityOpacity(rank, total, 0.18, 0.05),
    "--priority-border-opacity-light": getPriorityOpacity(
      rank,
      total,
      0.42,
      0.18
    ),
    "--priority-bg-opacity-dark": getPriorityOpacity(rank, total, 0.26, 0.08),
    "--priority-border-opacity-dark": getPriorityOpacity(
      rank,
      total,
      0.56,
      0.24
    ),
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-priority-rank={rank}
      className="priority-row flex items-center gap-2 p-2 rounded-md shadow-sm hover:shadow-md focus-within:ring-2 focus-within:ring-ring/50"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-1 hover:bg-accent rounded"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      <span
        aria-label={`优先级 ${rank}`}
        className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-primary/80"
      >
        {rank}
      </span>

      <span className="flex-1 text-sm truncate">{subscription.name}</span>

      {exhaustedScopeLabel && (
        <span
          aria-label={`额度用尽范围：${exhaustedScopeLabel}`}
          className="text-xs font-semibold text-red-500 shrink-0"
        >
          {exhaustedScopeLabel}
        </span>
      )}

      <Badge
        variant={
          subscription.status === "active"
            ? "success"
            : subscription.status === "paused"
              ? "warning"
              : "outline"
        }
        className="text-xs shrink-0"
      >
        {subscription.status === "active"
          ? "活跃"
          : subscription.status === "paused"
            ? "暂停"
            : "已取消"}
      </Badge>

      <button
        onClick={() => onRemove(subscription.id)}
        className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface SortablePriorityListProps {
  subscriptionOrder: string[];
  subscriptions: Subscription[];
  onRemove: (subscriptionId: string) => void;
}

export function SortablePriorityList({
  subscriptionOrder,
  subscriptions,
  onRemove,
}: SortablePriorityListProps) {
  const orderedSubscriptions = subscriptionOrder
    .map((id) => subscriptions.find((s) => s.id === id))
    .filter(Boolean) as Subscription[];

  if (orderedSubscriptions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        该场景暂无订阅，请从下方列表添加
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {orderedSubscriptions.map((subscription, index) => (
        <SortableItem
          key={subscription.id}
          id={subscription.id}
          subscription={subscription}
          onRemove={onRemove}
          rank={index + 1}
          total={orderedSubscriptions.length}
        />
      ))}
    </div>
  );
}
