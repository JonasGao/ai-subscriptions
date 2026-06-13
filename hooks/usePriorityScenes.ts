import { useState, useEffect, useCallback } from 'react'
import { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

interface SceneBase {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface UsePriorityScenesConfig<T extends SceneBase> {
  apiPath: string
  orderField: keyof T
}

export function usePriorityScenes<T extends SceneBase>({
  apiPath,
  orderField,
}: UsePriorityScenesConfig<T>) {
  const [scenes, setScenes] = useState<T[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingSceneId, setEditingSceneId] = useState<string>('')
  const [editingSceneName, setEditingSceneName] = useState('')
  const [newSceneName, setNewSceneName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadScenes()
  }, [])

  const loadScenes = async () => {
    try {
      setLoading(true)
      const response = await fetch(apiPath)
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
      const response = await fetch(apiPath, {
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
      const response = await fetch(`${apiPath}/${sceneId}`, {
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
      const response = await fetch(`${apiPath}/${editingSceneId}`, {
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

  const updateSceneOrder = useCallback(async (newOrder: string[], sceneId?: string) => {
    const targetSceneId = sceneId || selectedSceneId
    if (!targetSceneId) return

    try {
      const response = await fetch(`${apiPath}/${targetSceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder',
          [orderField as string]: newOrder,
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
  }, [apiPath, orderField, selectedSceneId])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id || !selectedScene) return

    const order = selectedScene[orderField] as string[]
    const oldIndex = order.indexOf(active.id as string)
    const newIndex = order.indexOf(over.id as string)

    const newOrder = arrayMove(order, oldIndex, newIndex)
    updateSceneOrder(newOrder)
  }, [selectedScene, orderField, updateSceneOrder])

  const handleRemoveItem = useCallback(async (itemId: string, sceneId?: string) => {
    const scene = scenes.find(s => s.id === (sceneId || selectedSceneId))
    if (!scene) return

    const order = scene[orderField] as string[]
    const newOrder = order.filter(id => id !== itemId)
    await updateSceneOrder(newOrder, sceneId)
  }, [scenes, selectedSceneId, orderField, updateSceneOrder])

  const handleAddItem = useCallback(async (itemId: string, sceneId?: string) => {
    const scene = scenes.find(s => s.id === (sceneId || selectedSceneId))
    if (!scene) return

    const order = scene[orderField] as string[]
    const newOrder = [...order, itemId]
    await updateSceneOrder(newOrder, sceneId)
  }, [scenes, selectedSceneId, orderField, updateSceneOrder])

  return {
    scenes,
    selectedSceneId,
    selectedScene,
    isCreating,
    editingSceneId,
    editingSceneName,
    newSceneName,
    loading,
    setIsCreating,
    setSelectedSceneId,
    setEditingSceneId,
    setEditingSceneName,
    setNewSceneName,
    loadScenes,
    handleCreateScene,
    handleDeleteScene,
    handleRenameScene,
    handleDragEnd,
    handleRemoveItem,
    handleAddItem,
  }
}
