"use client"

import { Plus, Trash2, Edit2, Check, X as XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ReactNode } from 'react'

interface ItemInfo {
  id: string
  name: string
}

interface SceneCardProps {
  sceneId: string
  sceneName: string
  isSelected: boolean
  isEditing: boolean
  editingName: string
  items: ItemInfo[]
  availableItems: ItemInfo[]
  hasItems: boolean
  emptyLabel: string
  addLabel: string
  sortableList: ReactNode
  onSelect: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onRename: () => void
  onEditingNameChange: (name: string) => void
  onAddItem: (itemId: string) => void
}

export function SceneCard({
  sceneName,
  isSelected,
  isEditing,
  editingName,
  availableItems,
  hasItems,
  emptyLabel,
  addLabel,
  sortableList,
  onSelect,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onRename,
  onEditingNameChange,
  onAddItem,
}: SceneCardProps) {
  return (
    <Card
      className={`flex flex-col cursor-pointer transition-all ${isSelected ? 'border-primary ring-1 ring-primary' : ''}`}
      onClick={onSelect}
    >
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        {isEditing ? (
          <div className="flex gap-2 flex-1">
            <Input
              value={editingName}
              onChange={(e) => onEditingNameChange(e.target.value)}
              placeholder="场景名称"
              className="flex-1"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                onCancelEdit()
              }}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <CardTitle className="text-lg font-medium">{sceneName}</CardTitle>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation()
                  onStartEdit()
                }}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        {hasItems ? (
          <div className="space-y-2 flex-1">
            {sortableList}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-2 flex-1">
            {emptyLabel}
          </div>
        )}

        {availableItems.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <div className="text-xs text-muted-foreground mb-2">{addLabel}</div>
            <div className="flex flex-wrap gap-2">
              {availableItems.slice(0, 6).map(item => (
                <Button
                  key={item.id}
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddItem(item.id)
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {item.name}
                </Button>
              ))}
              {availableItems.length > 6 && (
                <span className="text-xs text-muted-foreground">
                  +{availableItems.length - 6} 更多
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
