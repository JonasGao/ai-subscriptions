"use client"

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Subscription } from '@/lib/types'

interface SortableItemProps {
  id: string
  subscription: Subscription
  onRemove: (id: string) => void
}

function SortableItem({ id, subscription, onRemove }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 bg-card border rounded-md shadow-sm hover:shadow"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-1 hover:bg-accent rounded"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      
      <span className="flex-1 text-sm truncate">{subscription.name}</span>
      
      <Badge variant={subscription.status === 'active' ? 'success' : subscription.status === 'paused' ? 'warning' : 'outline'} className="text-xs shrink-0">
        {subscription.status === 'active' ? '活跃' : subscription.status === 'paused' ? '暂停' : '已取消'}
      </Badge>
      
      <button
        onClick={() => onRemove(subscription.id)}
        className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

interface SortablePriorityListProps {
  subscriptionOrder: string[]
  subscriptions: Subscription[]
  onRemove: (subscriptionId: string) => void
}

export function SortablePriorityList({
  subscriptionOrder,
  subscriptions,
  onRemove,
}: SortablePriorityListProps) {
  const orderedSubscriptions = subscriptionOrder
    .map(id => subscriptions.find(s => s.id === id))
    .filter(Boolean) as Subscription[]

  if (orderedSubscriptions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        该场景暂无订阅，请从下方列表添加
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {orderedSubscriptions.map(subscription => (
        <SortableItem
          key={subscription.id}
          id={subscription.id}
          subscription={subscription}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}