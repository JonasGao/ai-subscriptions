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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PriorityScene, Subscription } from '@/lib/types'
import { SortablePriorityList } from '@/components/SortablePriorityList'

interface PriorityManagerProps {
  subscriptions: Subscription[]
}

export function PriorityManager({ subscriptions }: PriorityManagerProps) {
  const [scenes, setScenes] = useState<PriorityScene[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingSceneId, setEditingSceneId] = useState<string>('')
  const [editingSceneName, setEditingSceneName] = useState('')
  const [newSceneName, setNewSceneName] = useState('')
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

  const handleDeleteScene = async (sceneId: string) => {
    if (!confirm('确定要删除该场景吗？')) return

    try {
      const response = await fetch(`/api/priorities/${sceneId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setScenes(prev => prev.filter(s => s.id !== sceneId))
        if (selectedSceneId === sceneId) {
          const remainingScenes = scenes.filter(s => s.id !== sceneId)
          if (remainingScenes.length > 0) {
            setSelectedSceneId(remainingScenes[0].id)
          } else {
            setSelectedSceneId('')
          }
        }
      }
    } catch (error) {
      console.error('Failed to delete scene:', error)
      alert('删除场景失败')
    }
  }

  const handleRenameScene = async () => {
    if (!editingSceneName.trim() || !editingSceneId) return

    try {
      const response = await fetch(`/api/priorities/${editingSceneId}`, {
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
        setEditingSceneId('')
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

  const updateSceneOrder = async (newOrder: string[], sceneId?: string) => {
    const targetSceneId = sceneId || selectedSceneId
    if (!targetSceneId) return

    try {
      const response = await fetch(`/api/priorities/${targetSceneId}`, {
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

  const handleRemoveSubscription = async (subscriptionId: string, sceneId?: string) => {
    const scene = scenes.find(s => s.id === (sceneId || selectedSceneId))
    if (!scene) return

    const newOrder = scene.subscriptionOrder.filter(id => id !== subscriptionId)
    await updateSceneOrder(newOrder, sceneId)
  }

  const handleAddSubscription = async (subscriptionId: string, sceneId?: string) => {
    const scene = scenes.find(s => s.id === (sceneId || selectedSceneId))
    if (!scene) return

    const newOrder = [...scene.subscriptionOrder, subscriptionId]
    await updateSceneOrder(newOrder, sceneId)
  }

  const getAvailableSubscriptions = (sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId)
    return subscriptions.filter(s => !scene?.subscriptionOrder.includes(s.id))
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">加载中...</div>
        </CardContent>
      </Card>
    )
  }

  if (scenes.length === 0 && !isCreating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            优先级管理
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              创建场景
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4">
            暂无场景，点击上方按钮创建新场景
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Scene creation form */}
      {isCreating && (
        <Card className="border-primary">
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input
                value={newSceneName}
                onChange={(e) => setNewSceneName(e.target.value)}
                placeholder="场景名称"
                className="flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleCreateScene}>
                <Check className="h-4 w-4 mr-1" />
                创建
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(false)
                  setNewSceneName('')
                }}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scene cards grid */}
      {scenes.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-stretch">
          {scenes.map((scene) => {
            const isSelected = scene.id === selectedSceneId
            const isEditing = editingSceneId === scene.id
            const sceneSubscriptions = subscriptions.filter(s => scene.subscriptionOrder.includes(s.id))
            const availableSubs = getAvailableSubscriptions(scene.id)

            return (
              <Card 
                key={scene.id}
                className={`flex flex-col cursor-pointer transition-all ${isSelected ? 'border-primary ring-1 ring-primary' : ''}`}
                onClick={() => setSelectedSceneId(scene.id)}
              >
                <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                  {isEditing ? (
                    <div className="flex gap-2 flex-1">
                      <Input
                        value={editingSceneName}
                        onChange={(e) => setEditingSceneName(e.target.value)}
                        placeholder="场景名称"
                        className="flex-1"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button 
                        size="icon" 
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRenameScene()
                        }}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingSceneId('')
                          setEditingSceneName('')
                        }}
                      >
                        <XIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <CardTitle className="text-lg font-medium">{scene.name}</CardTitle>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingSceneId(scene.id)
                            setEditingSceneName(scene.name)
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
                            handleDeleteScene(scene.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col flex-1">
                  {sceneSubscriptions.length > 0 ? (
                    <div className="space-y-2 flex-1">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={scene.subscriptionOrder}
                          strategy={verticalListSortingStrategy}
                        >
                          <SortablePriorityList
                            subscriptionOrder={scene.subscriptionOrder}
                            subscriptions={subscriptions}
                            onRemove={(id) => handleRemoveSubscription(id, scene.id)}
                          />
                        </SortableContext>
                      </DndContext>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground py-2 flex-1">
                      暂无订阅，点击下方添加
                    </div>
                  )}

                  {availableSubs.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="text-xs text-muted-foreground mb-2">添加订阅：</div>
                      <div className="flex flex-wrap gap-2">
                        {availableSubs.slice(0, 6).map(sub => (
                          <Button
                            key={sub.id}
                            variant="outline"
                            size="sm"
                            className="h-7"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAddSubscription(sub.id, scene.id)
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {sub.name}
                          </Button>
                        ))}
                        {availableSubs.length > 6 && (
                          <span className="text-xs text-muted-foreground">
                            +{availableSubs.length - 6} 更多
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add scene button */}
      {!isCreating && scenes.length > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setIsCreating(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          创建新场景
        </Button>
      )}
    </div>
  )
}