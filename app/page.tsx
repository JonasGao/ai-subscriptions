"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { StatsCards } from "@/components/StatsCards"
import { CategoryPieChart } from "@/components/CategoryPieChart"
import { SubscriptionList } from "@/components/SubscriptionList"
import { CategoryFilter } from "@/components/CategoryFilter"
import { SubscriptionForm } from "@/components/SubscriptionForm"
import { Subscription, SubscriptionFormData } from "@/lib/types"
import { defaultCategories } from "@/lib/types"
import { Plus, Settings, AlertTriangle, CreditCard, Wrench } from "lucide-react"
import Link from "next/link"
import { PriorityManager } from "@/components/PriorityManager"
import { ToolTab, ToolTabRef } from "@/components/ToolTab"
import { ThemeToggle } from "@/components/ThemeToggle"

export default function Home() {
  const [activeTab, setActiveTab] = useState<'subscriptions' | 'tools'>('subscriptions')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [categories, setCategories] = useState<string[]>(defaultCategories)
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('selectedCategory') || 'all'
    }
    return 'all'
  })
  const [selectedStatus, setSelectedStatus] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('selectedStatus') || 'all'
    }
    return 'all'
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const toolTabRef = useRef<ToolTabRef>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [subsRes, catsRes] = await Promise.all([
        fetch('/api/subscriptions'),
        fetch('/api/categories'),
      ])

      if (subsRes.ok) {
        const subsData = await subsRes.json()
        setSubscriptions(subsData)
      }

      if (catsRes.ok) {
        const catsData = await catsRes.json()
        setCategories(catsData)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category)
    localStorage.setItem('selectedCategory', category)
  }

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status)
    localStorage.setItem('selectedStatus', status)
  }

  const filteredSubscriptions = subscriptions.filter(sub => {
    const categoryMatch = selectedCategory === 'all' || sub.category === selectedCategory
    const statusMatch = selectedStatus === 'all' || sub.status === selectedStatus
    return categoryMatch && statusMatch
  })

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
    } catch {
      setErrorMessage('保存订阅时发生错误')
    } finally {
      setEditingSubscription(null)
    }
  }

  const handleEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription)
    setFormOpen(true)
  }

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

  const handleAddNew = () => {
    setEditingSubscription(null)
    setFormOpen(true)
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
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">AI订阅管理</h1>
          <div className="flex gap-2">
            <div className="flex border rounded-md overflow-hidden">
              <Button
                variant={activeTab === 'subscriptions' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('subscriptions')}
                className="rounded-none border-0"
              >
                <CreditCard className="h-4 w-4 mr-1" />
                订阅
              </Button>
              <Button
                variant={activeTab === 'tools' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('tools')}
                className="rounded-none border-0"
              >
                <Wrench className="h-4 w-4 mr-1" />
                工具
              </Button>
            </div>
            <ThemeToggle />
            <Link href="/change-password">
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {activeTab === 'subscriptions' && (
              <Button onClick={handleAddNew}>
                <Plus className="h-4 w-4 mr-2" />
                添加订阅
              </Button>
            )}
            {activeTab === 'tools' && (
              <Button onClick={() => toolTabRef.current?.openAddForm()}>
                <Plus className="h-4 w-4 mr-2" />
                添加工具
              </Button>
            )}
          </div>
        </div>

        {errorMessage && activeTab === 'subscriptions' && (
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

        {activeTab === 'subscriptions' && (
          <div key="subscriptions" className="flex flex-col gap-6 animate-fade-in">
            <StatsCards subscriptions={subscriptions} />

            <CategoryFilter
              categories={categories}
              selectedCategory={selectedCategory}
              selectedStatus={selectedStatus}
              onCategoryChange={handleCategoryChange}
              onStatusChange={handleStatusChange}
            />

            <div>
              <h2 className="text-xl font-semibold mb-4">订阅列表</h2>
              <SubscriptionList
                subscriptions={filteredSubscriptions}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">优先级管理</h2>
              <PriorityManager subscriptions={subscriptions} />
            </div>

            <div>
              <CategoryPieChart subscriptions={subscriptions} />
            </div>
          </div>
        )}

        {activeTab === 'tools' && (
          <div key="tools" className="animate-fade-in">
            <ToolTab ref={toolTabRef} categories={categories} />
          </div>
        )}

        <SubscriptionForm
          open={formOpen}
          onOpenChange={setFormOpen}
          subscription={editingSubscription}
          categories={categories}
          onSubmit={handleFormSubmit}
        />
      </div>
    </div>
  )
}
