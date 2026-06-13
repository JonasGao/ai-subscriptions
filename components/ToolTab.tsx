"use client"

import { useState, useEffect } from 'react'
import { Tool, ToolFormData, defaultProviders } from '@/lib/types'
import { ToolList } from '@/components/ToolList'
import { ToolForm } from '@/components/ToolForm'
import { ToolPriorityManager } from '@/components/ToolPriorityManager'
import { Button } from '@/components/ui/button'
import { Plus, AlertTriangle } from 'lucide-react'

interface ToolTabProps {
  categories: string[]
}

export function ToolTab({ categories }: ToolTabProps) {
  const [tools, setTools] = useState<Tool[]>([])
  const [toolFormOpen, setToolFormOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<Tool | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadTools = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/tools')
      if (res.ok) {
        setTools(await res.json())
      }
    } catch (error) {
      console.error('Failed to load tools:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTools()
  }, [])

  const handleToolFormSubmit = async (data: ToolFormData) => {
    setErrorMessage(null)
    try {
      if (editingTool) {
        const response = await fetch(`/api/tools/${editingTool.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })

        if (response.ok) {
          const updated = await response.json()
          setTools(prev =>
            prev.map(t => t.id === updated.id ? updated : t)
          )
        } else {
          const errorData = await response.json()
          setErrorMessage(errorData.error || '保存失败')
        }
      } else {
        const response = await fetch('/api/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })

        if (response.ok) {
          const newTool = await response.json()
          setTools(prev => [...prev, newTool])
        } else {
          const errorData = await response.json()
          setErrorMessage(errorData.error || '保存失败')
        }
      }
    } catch {
      setErrorMessage('保存工具时发生错误')
    } finally {
      setEditingTool(null)
    }
  }

  const handleEditTool = (tool: Tool) => {
    setEditingTool(tool)
    setToolFormOpen(true)
  }

  const handleDeleteTool = async (id: string) => {
    try {
      const response = await fetch(`/api/tools/${id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setTools(prev => prev.filter(t => t.id !== id))
      }
    } catch (error) {
      console.error('Failed to delete tool:', error)
    }
  }

  const handleAddNewTool = () => {
    setEditingTool(null)
    setToolFormOpen(true)
  }

  const handleReorderTools = async (toolIds: string[]) => {
    try {
      const response = await fetch('/api/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolIds })
      })

      if (response.ok) {
        const updatedTools = await response.json()
        setTools(updatedTools)
      }
    } catch (error) {
      console.error('Failed to reorder tools:', error)
    }
  }

  return (
    <div className="space-y-8">
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-red-700 hover:text-red-900"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">工具列表</h2>
        <Button onClick={handleAddNewTool}>
          <Plus className="h-4 w-4 mr-2" />
          添加工具
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          加载中...
        </div>
      ) : (
        <ToolList
          tools={tools}
          onEdit={handleEditTool}
          onDelete={handleDeleteTool}
          onReorder={handleReorderTools}
        />
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">工具优先级管理</h2>
        <ToolPriorityManager tools={tools} />
      </div>

      <ToolForm
        open={toolFormOpen}
        onOpenChange={setToolFormOpen}
        tool={editingTool}
        categories={categories}
        onSubmit={handleToolFormSubmit}
      />
    </div>
  )
}
