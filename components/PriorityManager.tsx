"use client"

import { useState, useEffect } from 'react'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus, Trash2, Edit2, Check, X as XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PriorityScene, Subscription } from '@/lib/types'
import { SortablePriorityList } from '@/components/SortablePriorityList'

interface PriorityManagerProps {
  subscriptions: Subscription[]
}

export function PriorityManager({ subscriptions }: PriorityManagerProps) {
  const [scenes, setScenes] = useState<PriorityScene[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [newSceneName, setNewSceneName] = useState('')
  const [editingSceneName, setEditingSceneName] = useState('')
  const [loading, setLoading] = useState(true)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    loadScenes()
  }, [])

  const loadScenes = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/priorities')
      if (response.ok) {
        const data = await response.json()
        setScenes(data.scenes)
        if (data.scenes.length > 0 && !selectedSceneId) {
          setSelectedSceneId(data.scenes[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load priority scenes:', error)
    } finally {
      setLoading(false)
    }
  }

  const selectedScene = scenes.find(s => s.id === selectedSceneId)

  const handleCreateScene = async () => {
    if (!newSceneName.trim()) return

    try {
      const response = await fetch('/api/priorities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSceneName.trim() }),
      })

      if (response.ok) {
        const newScene = await response.json()
        setScenes(prev => [...prev, newScene])
        setSelectedSceneId(newScene.id)
        setNewSceneName('')
        setIsCreating(false)
      } else {
        const error = await response.json()
        alert(error.error || '创建场景失败')
      }
    } catch (error) {
      console.error('Failed to create scene:', error)
      alert('创建场景失败')
    }
  }

  const handleDeleteScene = async () => {
    if (!selectedSceneId) return
    if (!confirm('确定要删除该场景吗？')) return

    try {
      const response = await fetch(`/api/priorities/${selectedSceneId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setScenes(prev => prev.filter(s => s.id !== selectedSceneId))
        const remainingScenes = scenes.filter(s => s.id !== selectedSceneId)
        if (remainingScenes.length > 0) {
          setSelectedSceneId(remainingScenes[0].id)
        } else {
          setSelectedSceneId('')
        }
      }
    } catch (error) {
      console.error('Failed to delete scene:', error)
      alert('删除场景失败')
    }
  }

  const handleRenameScene = async () => {
    if (!editingSceneName.trim() || !selectedSceneId) return

    try {
      const response = await fetch(`/api/priorities/${selectedSceneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingSceneName.trim() }),
      })

      if (response.ok) {
        const updatedScene = await response.json()
        setScenes(prev =>
          prev.map(s => s.id === updatedScene.id ? updatedScene : s)
        )
        setEditingSceneName('')
        setIsEditing(false)
      } else {
        const error = await response.json()
        alert(error.error || '重命名场景失败')
      }
    } catch (error) {
      console.error('Failed to rename scene:', error)
      alert('重命名场景失败')
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id || !selectedScene) return

    const oldIndex = selectedScene.subscriptionOrder.indexOf(active.id as string)
    const newIndex = selectedScene.subscriptionOrder.indexOf(over.id as string)

    const newOrder = arrayMove(selectedScene.subscriptionOrder, oldIndex, newIndex)

    updateSceneOrder(newOrder)
  }

  const updateSceneOrder = async (newOrder: string[]) => {
    if (!selectedSceneId) return

    try {
      const response = await fetch(`/api/priorities/${selectedSceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder',
          subscriptionOrder: newOrder,
        }),
      })

      if (response.ok) {
        const updatedScene = await response.json()
        setScenes(prev =>
          prev.map(s => s.id === updatedScene.id ? updatedScene : s)
        )
      }
    } catch (error) {
      console.error('Failed to update order:', error)
    }
  }

  const handleRemoveSubscription = async (subscriptionId: string) => {
    if (!selectedScene) return

    const newOrder = selectedScene.subscriptionOrder.filter(id => id !== subscriptionId)
    await updateSceneOrder(newOrder)
  }

  const handleAddSubscription = async (subscriptionId: string) => {
    if (!selectedScene) return

    const newOrder = [...selectedScene.subscriptionOrder, subscriptionId]
    await updateSceneOrder(newOrder)
  }

  const availableSubscriptions = subscriptions.filter(
    s => !selectedScene?.subscriptionOrder.includes(s.id)
  )

  if (loading) {
    return (
      <div className="p-4 border rounded-lg bg-gray-50">
        <div className="text-center text-gray-500 py-8">加载中...</div>
      </div>
    )
  }

  return (
    <div className="p-4 border rounded-lg bg-gray-50">
      <h3 className="text-lg font-semibold mb-4">优先级管理</h3>

      {/* Scene selector */}
      <div className="flex gap-2 mb-4">
        {scenes.length > 0 ? (
          <>
            <Select value={selectedSceneId} onValueChange={setSelectedSceneId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="选择场景" />
              </SelectTrigger>
              <SelectContent>
                {scenes.map(scene => (
                  <SelectItem key={scene.id} value={scene.id}>
                    {scene.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {!isEditing && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setIsEditing(true)
                    setEditingSceneName(selectedScene?.name || '')
                  }}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleDeleteScene}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </>
        ) : (
          <div className="flex-1 text-sm text-gray-500">暂无场景，请创建新场景</div>
        )}

        {!isCreating && !isEditing && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Scene creation form */}
      {isCreating && (
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newSceneName}
            onChange={(e) => setNewSceneName(e.target.value)}
            placeholder="场景名称"
            className="flex-1 px-3 py-2 border rounded-md text-sm"
            autoFocus
          />
          <Button size="icon" onClick={handleCreateScene}>
            <Check className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setIsCreating(false)
              setNewSceneName('')
            }}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Scene rename form */}
      {isEditing && selectedScene && (
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={editingSceneName}
            onChange={(e) => setEditingSceneName(e.target.value)}
            placeholder="场景名称"
            className="flex-1 px-3 py-2 border rounded-md text-sm"
            autoFocus
          />
          <Button size="icon" onClick={handleRenameScene}>
            <Check className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setIsEditing(false)
              setEditingSceneName('')
            }}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Priority list */}
      {selectedScene && (
        <div className="mb-4">
          <h4 className="text-sm font-medium mb-2 text-gray-700">
            当前优先级（拖拽调整顺序）
          </h4>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={selectedScene.subscriptionOrder}
              strategy={verticalListSortingStrategy}
            >
              <SortablePriorityList
                subscriptionOrder={selectedScene.subscriptionOrder}
                subscriptions={subscriptions}
                onRemove={handleRemoveSubscription}
              />
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Available subscriptions */}
      {selectedScene && availableSubscriptions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-gray-700">
            可用订阅（点击添加到场景）
          </h4>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {availableSubscriptions.map(subscription => (
              <div
                key={subscription.id}
                className="flex items-center justify-between p-2 bg-white border rounded-md shadow-sm hover:shadow cursor-pointer"
                onClick={() => handleAddSubscription(subscription.id)}
              >
                <span className="text-sm">{subscription.name}</span>
                <Plus className="h-4 w-4 text-gray-400" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}