"use client";

import { Subscription } from "@/lib/types";
import { SubscriptionCard } from "@/components/SubscriptionCard";

interface SubscriptionListProps {
  subscriptions: Subscription[];
  onEdit: (subscription: Subscription) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, newStatus: "active" | "paused") => void;
  onScheduleToggle?: (
    subscriptionId: string,
    scheduleId: string,
    exhausted: boolean
  ) => void;
}

export function SubscriptionList({
  subscriptions,
  onEdit,
  onDelete,
  onStatusChange,
  onScheduleToggle,
}: SubscriptionListProps) {
  if (subscriptions.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        暂无订阅数据，点击上方按钮添加新订阅
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 items-stretch">
      {subscriptions.map((subscription) => (
        <SubscriptionCard
          key={subscription.id}
          subscription={subscription}
          onEdit={onEdit}
          onDelete={onDelete}
          onStatusChange={onStatusChange}
          onScheduleToggle={onScheduleToggle}
        />
      ))}
    </div>
  );
}
