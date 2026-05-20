"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { StatsCards } from "@/components/StatsCards"
import { CategoryPieChart } from "@/components/CategoryPieChart"
import { SubscriptionList } from "@/components/SubscriptionList"
import { CategoryFilter } from "@/components/CategoryFilter"
import { SubscriptionForm } from "@/components/SubscriptionForm"
import { ToolList } from "@/components/ToolList"
import { ToolForm } from "@/components/ToolForm"
import { Subscription, SubscriptionFormData, Tool, ToolFormData } from "@/lib/types"
import { defaultCategories } from "@/lib/types"
import { Plus, Settings, AlertTriangle, CreditCard, Wrench } from "lucide-react"
import Link from "next/link"
import { PriorityManager } from "@/components/PriorityManager"

export default function Home() {
  const [activeTab, setActiveTab] = useState<'subscriptions' | 'tools'>('subscriptions')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [categories, setCategories] = useState<string[]>(defaultCategories)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [toolFormOpen, setToolFormOpen] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null)
  const [editingTool, setEditingTool] = useState<Tool | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Load subscriptions and categories on mount
  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [subsRes, catsRes, toolsRes] = await Promise.all([
        fetch('/api/subscriptions'),
        fetch('/api/categories'),
        fetch('/api/tools')
      ])
      
      if (subsRes.ok) {
        const subsData = await subsRes.json()
        setSubscriptions(subsData)
      }
      
      if (catsRes.ok) {
        const catsData = await catsRes.json()
        setCategories(catsData)
      }

      if (toolsRes.ok) {
        const toolsData = await toolsRes.json()
        setTools(toolsData)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter subscriptions based on selected category and status
  const filteredSubscriptions = subscriptions.filter(sub => {
    const categoryMatch = selectedCategory === 'all' || sub.category === selectedCategory
    const statusMatch = selectedStatus === 'all' || sub.status === selectedStatus
    return categoryMatch && statusMatch
  })

  // Handle form submission (create or update)
  const handleFormSubmit = async (data: SubscriptionFormData) => {
    setErrorMessage(null)
    try {
      if (editingSubscription) {
        const response = await fetch(`/api/subscriptions/${editingSubscription.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
        
        if (response.ok) {
          const updated = await response.json()
          setSubscriptions(prev => 
            prev.map(s => s.id === updated.id ? updated : s)
          )
        } else {
          const errorData = await response.json()
          setErrorMessage(errorData.error || '保存失败')
        }
      } else {
        const response = await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
        
        if (response.ok) {
          const newSub = await response.json()
          setSubscriptions(prev => [...prev, newSub])
          
          if (!categories.includes(data.category)) {
            setCategories(prev => [...prev, data.category])
          }
        } else {
          const errorData = await response.json()
          setErrorMessage(errorData.error || '保存失败')
        }
      }
    } catch (error) {
      console.error('Failed to save subscription:', error)
      setErrorMessage('保存订阅时发生错误')
    } finally {
      setEditingSubscription(null)
    }
  }

  // Handle edit button click
  const handleEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription)
    setFormOpen(true)
  }

  // Handle delete button click
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/subscriptions/${id}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setSubscriptions(prev => prev.filter(s => s.id !== id))
      }
    } catch (error) {
      console.error('Failed to delete subscription:', error)
    }
  }

  // Handle add new button click
  const handleAddNew = () => {
    setEditingSubscription(null)
    setFormOpen(true)
  }

  // Tool handlers
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
    } catch (error) {
      console.error('Failed to save tool:', error)
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

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center h-[400px] text-muted-foreground">
          加载中...
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">AI订阅管理</h1>
          <div className="flex gap-2">
            {/* Tab Buttons */}
            <div className="flex gap-1 border rounded-md p-1">
              <Button
                variant={activeTab === 'subscriptions' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('subscriptions')}
              >
                <CreditCard className="h-4 w-4 mr-1" />
                订阅
              </Button>
              <Button
                variant={activeTab === 'tools' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('tools')}
              >
                <Wrench className="h-4 w-4 mr-1" />
                工具
              </Button>
            </div>
            <Link href="/change-password">
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {activeTab === 'subscriptions' ? (
              <Button onClick={handleAddNew}>
                <Plus className="h-4 w-4 mr-2" />
                添加订阅
              </Button>
            ) : (
              <Button onClick={handleAddNewTool}>
                <Plus className="h-4 w-4 mr-2" />
                添加工具
              </Button>
            )}
          </div>
        </div>

        {/* Error Message */}
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

        {/* Subscriptions Tab */}
        {activeTab === 'subscriptions' && (
          <>
            {/* Stats Cards */}
            <StatsCards subscriptions={subscriptions} />

            {/* Filters */}
            <CategoryFilter
              categories={categories}
              selectedCategory={selectedCategory}
              selectedStatus={selectedStatus}
              onCategoryChange={setSelectedCategory}
              onStatusChange={setSelectedStatus}
            />

            {/* Main Content Grid */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Subscription List */}
              <div>
                <h2 className="text-xl font-semibold mb-4">订阅列表</h2>
                <SubscriptionList
                  subscriptions={filteredSubscriptions}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </div>

              {/* Priority Manager */}
              <div>
                <h2 className="text-xl font-semibold mb-4">优先级管理</h2>
                <PriorityManager subscriptions={subscriptions} />
              </div>
            </div>

            {/* Category Pie Chart */}
            <div>
              <CategoryPieChart subscriptions={subscriptions} />
            </div>
          </>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Tool List */}
            <div>
              <h2 className="text-xl font-semibold mb-4">工具列表</h2>
              <ToolList
                tools={tools}
                onEdit={handleEditTool}
                onDelete={handleDeleteTool}
              />
            </div>

            {/* Priority Manager */}
            <div>
              <h2 className="text-xl font-semibold mb-4">优先级管理</h2>
              <PriorityManager subscriptions={subscriptions} />
            </div>
          </div>
        )}

        {/* Subscription Form Dialog */}
        <SubscriptionForm
          open={formOpen}
          onOpenChange={setFormOpen}
          subscription={editingSubscription}
          categories={categories}
          onSubmit={handleFormSubmit}
        />

        {/* Tool Form Dialog */}
        <ToolForm
          open={toolFormOpen}
          onOpenChange={setToolFormOpen}
          tool={editingTool}
          categories={categories}
          onSubmit={handleToolFormSubmit}
        />
      </div>
    </div>
  )
}