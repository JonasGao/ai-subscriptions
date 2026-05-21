"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tool, defaultProviders, allowedToolForms } from "@/lib/types"
import { Edit, Trash2, GripVertical, ExternalLink } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface ToolListProps {
  tools: Tool[]
  onEdit: (tool: Tool) => void
  onDelete: (id: string) => void
  onReorder: (toolIds: string[]) => void
}

function getProviderName(provider: string, providerCustom?: string): string {
  if (provider === 'other' && providerCustom) {
    return providerCustom
  }
  const found = defaultProviders.find(p => p.id === provider)
  return found?.name || provider
}

interface SortableToolCardProps {
  tool: Tool
  onEdit: (tool: Tool) => void
  onDelete: (id: string) => void
}

function SortableToolCard({ tool, onEdit, onDelete }: SortableToolCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tool.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const providerName = getProviderName(tool.provider, tool.providerCustom)

  return (
    <Card ref={setNodeRef} style={style}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <button
            className="cursor-grab active:cursor-grabbing touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
          <CardTitle className="text-lg font-medium">{tool.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex items-center gap-4 py-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm text-muted-foreground">分类:</span>
          <Badge variant="outline" className="text-xs">{tool.category}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm text-muted-foreground">提供商:</span>
          <span className="text-sm font-medium">{providerName}</span>
        </div>
        {tool.forms && tool.forms.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">形式:</span>
            <div className="flex gap-1.5 flex-wrap">
              {tool.forms.map(form => (
                <Badge key={form} variant="secondary" className="text-xs">{form}</Badge>
              ))}
            </div>
          </div>
        )}
        {tool.isOpenSource && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
              开源
            </Badge>
            {tool.repoUrl && (
              <a
                href={tool.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                仓库
              </a>
            )}
          </div>
        )}
        <div className="flex gap-2 ml-auto">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onEdit(tool)}
          >
            <Edit className="h-4 w-4 mr-1" />
            编辑
          </Button>
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={() => onDelete(tool.id)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ToolList({ tools, onEdit, onDelete, onReorder }: ToolListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tools.findIndex(t => t.id === active.id)
      const newIndex = tools.findIndex(t => t.id === over.id)
      
      const newTools = arrayMove(tools, oldIndex, newIndex)
      onReorder(newTools.map(t => t.id))
    }
  }

  if (tools.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        暂无工具，点击右上角&ldquo;添加工具&rdquo;按钮创建
      </div>
    )
  }

  const sortedTools = [...tools].sort((a, b) => a.order - b.order)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortedTools.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {sortedTools.map(tool => (
            <SortableToolCard
              key={tool.id}
              tool={tool}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}