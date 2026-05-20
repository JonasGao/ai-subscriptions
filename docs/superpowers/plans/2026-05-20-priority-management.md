# 订阅优先级管理功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 订阅管理应用添加多场景优先级管理功能，用户可以为不同场景配置订阅的使用优先级顺序。

**Architecture:** 创建独立的数据文件 `priorities.json` 存储场景配置，通过订阅 ID 引用。新增 API 端点管理场景，使用 @dnd-kit 实现拖拽排序，调整页面布局将优先级管理组件放置在订阅列表旁边。

**Tech Stack:** Next.js 14, React 18, TypeScript, @dnd-kit/core, @dnd-kit/sortable, Radix UI

---

## 文件结构

**新增文件：**
- `data/priorities.json` - 场景配置数据
- `lib/priorities.ts` - 优先级数据访问函数
- `app/api/priorities/route.ts` - GET 和 POST 端点
- `app/api/priorities/[id]/route.ts` - PUT 和 DELETE 端点
- `components/PriorityManager.tsx` - 主容器组件
- `components/SortablePriorityList.tsx` - 可拖拽列表组件

**修改文件：**
- `package.json` - 添加 @dnd-kit 依赖
- `app/page.tsx` - 调整布局，集成优先级管理组件
- `lib/types.ts` - 添加优先级相关类型定义

---

## Task 1: 添加 @dnd-kit 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 @dnd-kit 包**

运行命令：
```bash
source ~/.nvm/nvm.sh && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

预期输出：
```
added 3 packages in 5s
```

- [ ] **Step 2: 验证安装成功**

运行命令：
```bash
source ~/.nvm/nvm.sh && npm list @dnd-kit/core
```

预期输出：
```
@dnd-kit/core@x.x.x
```

- [ ] **Step 3: 提交依赖更新**

运行命令：
```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit dependencies for drag-and-drop"
```

---

## Task 2: 添加优先级类型定义

**Files:**
- Modify: `lib/types.ts:71`

- [ ] **Step 1: 添加类型定义**

在 `lib/types.ts` 文件末尾添加以下内容：

```typescript
export interface PriorityScene {
  id: string
  name: string
  subscriptionOrder: string[]
  createdAt: string
  updatedAt: string
}

export interface PriorityData {
  scenes: PriorityScene[]
}

export interface PrioritySceneFormData {
  name: string
}
```

- [ ] **Step 2: 验证类型定义无语法错误**

运行命令：
```bash
npx tsc --noEmit lib/types.ts
```

预期输出：
```
无错误输出
```

- [ ] **Step 3: 提交类型定义**

运行命令：
```bash
git add lib/types.ts
git commit -m "feat: add priority scene type definitions"
```

---

## Task 3: 创建优先级数据访问函数

**Files:**
- Create: `lib/priorities.ts`

- [ ] **Step 1: 创建优先级数据访问文件**

创建文件 `lib/priorities.ts`：

```typescript
import fs from 'fs'
import path from 'path'
import { PriorityData, PriorityScene } from './types'
import { v4 as uuidv4 } from 'uuid'

const dataDir = path.join(process.cwd(), 'data')
const prioritiesFile = path.join(dataDir, 'priorities.json')

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function getInitialPriorityData(): PriorityData {
  return {
    scenes: []
  }
}

export function readPriorityData(): PriorityData {
  ensureDataDir()
  
  if (!fs.existsSync(prioritiesFile)) {
    const initialData = getInitialPriorityData()
    fs.writeFileSync(prioritiesFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
  
  try {
    const fileContent = fs.readFileSync(prioritiesFile, 'utf-8')
    const data = JSON.parse(fileContent) as PriorityData
    return data
  } catch (error) {
    console.error('Failed to parse priorities file:', error)
    const initialData = getInitialPriorityData()
    fs.writeFileSync(prioritiesFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writePriorityData(data: PriorityData): void {
  ensureDataDir()
  fs.writeFileSync(prioritiesFile, JSON.stringify(data, null, 2))
}

export function getPriorityScenes(): PriorityScene[] {
  const data = readPriorityData()
  return data.scenes
}

export function getPrioritySceneById(id: string): PriorityScene | null {
  const scenes = getPriorityScenes()
  return scenes.find(s => s.id === id) || null
}

export function createPriorityScene(sceneData: { name: string }): PriorityScene {
  if (!sceneData.name || sceneData.name.trim() === '') {
    throw new Error('Scene name is required')
  }
  
  const data = readPriorityData()
  
  if (data.scenes.some(s => s.name === sceneData.name)) {
    throw new Error('Scene name already exists')
  }
  
  const now = new Date().toISOString()
  
  const newScene: PriorityScene = {
    id: uuidv4(),
    name: sceneData.name.trim(),
    subscriptionOrder: [],
    createdAt: now,
    updatedAt: now
  }
  
  data.scenes.push(newScene)
  writePriorityData(data)
  
  return newScene
}

export function updatePriorityScene(
  id: string,
  updates: Partial<Omit<PriorityScene, 'id' | 'createdAt'>>
): PriorityScene | null {
  if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim() === '')) {
    throw new Error('Scene name must be a non-empty string')
  }
  
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === id)
  
  if (index === -1) {
    return null
  }
  
  if (updates.name && data.scenes.some(s => s.id !== id && s.name === updates.name)) {
    throw new Error('Scene name already exists')
  }
  
  data.scenes[index] = {
    ...data.scenes[index],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  
  writePriorityData(data)
  return data.scenes[index]
}

export function deletePriorityScene(id: string): boolean {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === id)
  
  if (index === -1) {
    return false
  }
  
  data.scenes.splice(index, 1)
  writePriorityData(data)
  return true
}

export function addSubscriptionToScene(sceneId: string, subscriptionId: string): PriorityScene | null {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)
  
  if (index === -1) {
    return null
  }
  
  if (data.scenes[index].subscriptionOrder.includes(subscriptionId)) {
    return data.scenes[index]
  }
  
  data.scenes[index].subscriptionOrder.push(subscriptionId)
  data.scenes[index].updatedAt = new Date().toISOString()
  
  writePriorityData(data)
  return data.scenes[index]
}

export function removeSubscriptionFromScene(sceneId: string, subscriptionId: string): PriorityScene | null {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)
  
  if (index === -1) {
    return null
  }
  
  const subIndex = data.scenes[index].subscriptionOrder.indexOf(subscriptionId)
  if (subIndex === -1) {
    return data.scenes[index]
  }
  
  data.scenes[index].subscriptionOrder.splice(subIndex, 1)
  data.scenes[index].updatedAt = new Date().toISOString()
  
  writePriorityData(data)
  return data.scenes[index]
}

export function reorderSubscriptionsInScene(
  sceneId: string,
  subscriptionOrder: string[]
): PriorityScene | null {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)
  
  if (index === -1) {
    return null
  }
  
  data.scenes[index].subscriptionOrder = subscriptionOrder
  data.scenes[index].updatedAt = new Date().toISOString()
  
  writePriorityData(data)
  return data.scenes[index]
}
```

- [ ] **Step 2: 验证文件无语法错误**

运行命令：
```bash
npx tsc --noEmit lib/priorities.ts
```

预期输出：
```
无错误输出
```

- [ ] **Step 3: 提交数据访问函数**

运行命令：
```bash
git add lib/priorities.ts
git commit -m "feat: implement priority data access layer"
```

---

## Task 4: 创建优先级 API 端点（GET 和 POST）

**Files:**
- Create: `app/api/priorities/route.ts`

- [ ] **Step 1: 创建 API 路由文件**

创建文件 `app/api/priorities/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPriorityScenes, createPriorityScene } from '@/lib/priorities'
import { PrioritySceneFormData } from '@/lib/types'

export async function GET() {
  try {
    const scenes = getPriorityScenes()
    return NextResponse.json({ scenes })
  } catch (error) {
    console.error('GET /api/priorities error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch priority scenes' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PrioritySceneFormData = await request.json()
    
    if (!body.name || body.name.trim() === '') {
      return NextResponse.json(
        { error: 'Scene name is required' },
        { status: 400 }
      )
    }
    
    const newScene = createPriorityScene({ name: body.name })
    
    return NextResponse.json(newScene, { status: 201 })
  } catch (error) {
    console.error('POST /api/priorities error:', error)
    
    if (error instanceof Error && error.message === 'Scene name already exists') {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      )
    }
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to create priority scene' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: 验证 API 路由无语法错误**

运行命令：
```bash
npx tsc --noEmit app/api/priorities/route.ts
```

预期输出：
```
无错误输出
```

- [ ] **Step 3: 提交 API 路由**

运行命令：
```bash
git add app/api/priorities/route.ts
git commit -m "feat: implement GET and POST endpoints for priorities"
```

---

## Task 5: 创建优先级 API 端点（PUT 和 DELETE）

**Files:**
- Create: `app/api/priorities/[id]/route.ts`

- [ ] **Step 1: 创建动态路由文件**

创建文件 `app/api/priorities/[id]/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import {
  getPrioritySceneById,
  updatePriorityScene,
  deletePriorityScene,
  reorderSubscriptionsInScene
} from '@/lib/priorities'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scene = getPrioritySceneById(params.id)
    
    if (!scene) {
      return NextResponse.json(
        { error: 'Priority scene not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(scene)
  } catch (error) {
    console.error('GET /api/priorities/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch priority scene' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      return NextResponse.json(
        { error: 'Scene name must be a non-empty string' },
        { status: 400 }
      )
    }
    
    const updatedScene = updatePriorityScene(params.id, body)
    
    if (!updatedScene) {
      return NextResponse.json(
        { error: 'Priority scene not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(updatedScene)
  } catch (error) {
    console.error('PUT /api/priorities/[id] error:', error)
    
    if (error instanceof Error && error.message === 'Scene name already exists') {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      )
    }
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to update priority scene' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = deletePriorityScene(params.id)
    
    if (!deleted) {
      return NextResponse.json(
        { error: 'Priority scene not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/priorities/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to delete priority scene' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    
    if (body.action === 'reorder' && body.subscriptionOrder) {
      if (!Array.isArray(body.subscriptionOrder)) {
        return NextResponse.json(
          { error: 'subscriptionOrder must be an array' },
          { status: 400 }
        )
      }
      
      const updatedScene = reorderSubscriptionsInScene(params.id, body.subscriptionOrder)
      
      if (!updatedScene) {
        return NextResponse.json(
          { error: 'Priority scene not found' },
          { status: 404 }
        )
      }
      
      return NextResponse.json(updatedScene)
    }
    
    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('PATCH /api/priorities/[id] error:', error)
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to update priority scene' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: 验证动态路由无语法错误**

运行命令：
```bash
npx tsc --noEmit app/api/priorities/[id]/route.ts
```

预期输出：
```
无错误输出
```

- [ ] **Step 3: 提交动态路由**

运行命令：
```bash
git add app/api/priorities/[id]/route.ts
git commit -m "feat: implement PUT, DELETE, and PATCH endpoints for priorities"
```

---

## Task 6: 创建可拖拽优先级列表组件

**Files:**
- Create: `components/SortablePriorityList.tsx`

- [ ] **Step 1: 创建可拖拽列表组件**

创建文件 `components/SortablePriorityList.tsx`：

```typescript
"use client"

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
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
      className="flex items-center gap-2 p-2 bg-white border rounded-md shadow-sm hover:shadow"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-1 hover:bg-gray-100 rounded"
      >
        <GripVertical className="h-4 w-4 text-gray-400" />
      </button>
      
      <span className="flex-1 text-sm">{subscription.name}</span>
      
      <button
        onClick={() => onRemove(subscription.id)}
        className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500"
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
      <div className="text-sm text-gray-500 text-center py-4">
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
```

- [ ] **Step 2: 验证组件无语法错误**

运行命令：
```bash
npx tsc --noEmit components/SortablePriorityList.tsx
```

预期输出：
```
无错误输出
```

- [ ] **Step 3: 提交可拖拽组件**

运行命令：
```bash
git add components/SortablePriorityList.tsx
git commit -m "feat: create sortable priority list component"
```

---

## Task 7: 创建优先级管理主组件

**Files:**
- Create: `components/PriorityManager.tsx`

- [ ] **Step 1: 创建优先级管理主组件**

创建文件 `components/PriorityManager.tsx`：

```typescript
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
```

- [ ] **Step 2: 验证主组件无语法错误**

运行命令：
```bash
npx tsc --noEmit components/PriorityManager.tsx
```

预期输出：
```
无错误输出
```

- [ ] **Step 3: 提交主组件**

运行命令：
```bash
git add components/PriorityManager.tsx
git commit -m "feat: create priority manager main component"
```

---

## Task 8: 修改主页集成优先级管理组件

**Files:**
- Modify: `app/page.tsx:1-199`

- [ ] **Step 1: 导入优先级管理组件**

在 `app/page.tsx` 文件开头的导入区域添加：

```typescript
import { PriorityManager } from "@/components/PriorityManager"
```

（在第13行 `import Link from "next/link"` 之后添加）

- [ ] **Step 2: 修改页面布局**

将 `app/page.tsx` 中第171行开始的网格布局部分：

```typescript
{/* Main Content Grid */}
<div className="grid gap-6 lg:grid-cols-3">
```

修改为：

```typescript
{/* Main Content Grid */}
<div className="grid gap-6 lg:grid-cols-4">
```

- [ ] **Step 3: 调整列布局**

将第172-186行的内容区域修改为：

```typescript
{/* Subscription List */}
<div className="lg:col-span-2">
  <h2 className="text-xl font-semibold mb-4">订阅列表</h2>
  <SubscriptionList
    subscriptions={filteredSubscriptions}
    onEdit={handleEdit}
    onDelete={handleDelete}
  />
</div>

{/* Priority Manager */}
<div className="lg:col-span-1">
  <h2 className="text-xl font-semibold mb-4">优先级管理</h2>
  <PriorityManager subscriptions={subscriptions} />
</div>

{/* Pie Chart */}
<div className="lg:col-span-1">
  <CategoryPieChart subscriptions={subscriptions} />
</div>
```

- [ ] **Step 4: 验证修改无语法错误**

运行命令：
```bash
npx tsc --noEmit app/page.tsx
```

预期输出：
```
无错误输出
```

- [ ] **Step 5: 提交页面修改**

运行命令：
```bash
git add app/page.tsx
git commit -m "feat: integrate priority manager into main page layout"
```

---

## Task 9: 测试完整功能

**Files:**
- None (手动测试)

- [ ] **Step 1: 启动开发服务器**

运行命令：
```bash
source ~/.nvm/nvm.sh && npm run dev
```

预期输出：
```
ready started server on 0.0.0.0:3000
```

- [ ] **Step 2: 测试创建场景**

手动操作：
1. 打开浏览器访问 http://localhost:3000
2. 在优先级管理区域点击 "+" 按钮
3. 输入场景名称"工作日"
4. 点击确认按钮
5. 验证场景创建成功并自动选中

- [ ] **Step 3: 测试添加订阅到场景**

手动操作：
1. 在"可用订阅"区域点击一个订阅
2. 验证订阅添加到优先级列表
3. 重复添加多个订阅

- [ ] **Step 4: 测试拖拽排序**

手动操作：
1. 拖拽优先级列表中的订阅项
2. 验证顺序改变
3. 验证数据保存成功

- [ ] **Step 5: 测试删除订阅**

手动操作：
1. 点击优先级列表中的订阅项的 "X" 按钮
2. 验证订阅从列表中移除
3. 验证订阅出现在可用订阅列表中

- [ ] **Step 6: 测试重命名场景**

手动操作：
1. 点击场景选择器旁边的编辑按钮
2. 输入新的场景名称
3. 点击确认按钮
4. 验证场景名称更新成功

- [ ] **Step 7: 测试删除场景**

手动操作：
1. 点击场景选择器旁边的删除按钮
2. 确认删除对话框点击"确定"
3. 验证场景删除成功
4. 验证自动选中其他场景

- [ ] **Step 8: 测试多场景管理**

手动操作：
1. 创建第二个场景"周末"
2. 添加不同的订阅
3. 切换场景验证数据独立

- [ ] **Step 9: 停止开发服务器**

运行命令：
```bash
Ctrl+C
```

---

## Task 10: 最终提交和验证

**Files:**
- None (构建验证)

- [ ] **Step 1: 运行构建命令**

运行命令：
```bash
source ~/.nvm/nvm.sh && npm run build
```

预期输出：
```
Build successful
```

- [ ] **Step 2: 运行 lint 检查**

运行命令：
```bash
source ~/.nvm/nvm.sh && npm run lint
```

预期输出：
```
No lint errors
```

- [ ] **Step 3: 查看所有提交**

运行命令：
```bash
git log --oneline -15
```

预期输出：
```
显示所有本次功能的提交记录
```

- [ ] **Step 4: 推送到远程仓库（可选）**

运行命令：
```bash
git push origin main
```

---

## 完成标志

当所有任务完成时，应该具备：
- ✅ 多场景优先级管理功能
- ✅ 拖拽排序功能
- ✅ 场景创建、编辑、删除功能
- ✅ 订阅添加和移除功能
- ✅ 响应式布局
- ✅ 无语法错误和 lint 错误
- ✅ 所有代码已提交到 git