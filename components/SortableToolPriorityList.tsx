"use client"

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { Tool } from '@/lib/types'

interface SortableToolItemProps {
  id: string
  tool: Tool
  onRemove: (id: string) => void
}

function SortableToolItem({ id, tool, onRemove }: SortableToolItemProps) {
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
      className="flex items-center gap-2 p-2 bg-white border rounded-md shadow-sm hover:shadow"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-1 hover:bg-gray-100 rounded"
      >
        <GripVertical className="h-4 w-4 text-gray-400" />
      </button>

      <span className="flex-1 text-sm">{tool.name}</span>

      <button
        onClick={() => onRemove(tool.id)}
        className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

interface SortableToolPriorityListProps {
  toolOrder: string[]
  tools: Tool[]
  onRemove: (toolId: string) => void
}

export function SortableToolPriorityList({
  toolOrder,
  tools,
  onRemove,
}: SortableToolPriorityListProps) {
  const orderedTools = toolOrder
    .map(id => tools.find(t => t.id === id))
    .filter(Boolean) as Tool[]

  if (orderedTools.length === 0) {
    return (
      <div className="text-sm text-gray-500 text-center py-4">
        该场景暂无工具，请从下方列表添加
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {orderedTools.map(tool => (
        <SortableToolItem
          key={tool.id}
          id={tool.id}
          tool={tool}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}
