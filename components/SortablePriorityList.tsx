"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Subscription } from "@/lib/types";
import type { CSSProperties } from "react";

interface SortableItemProps {
  id: string;
  subscription: Subscription;
  onRemove: (id: string) => void;
  rank: number;
  total: number;
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
