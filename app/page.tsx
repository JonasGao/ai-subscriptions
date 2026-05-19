"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { StatsCards } from "@/components/StatsCards"
import { CategoryPieChart } from "@/components/CategoryPieChart"
import { SubscriptionList } from "@/components/SubscriptionList"
import { CategoryFilter } from "@/components/CategoryFilter"
import { SubscriptionForm } from "@/components/SubscriptionForm"
import { Subscription, SubscriptionFormData } from "@/lib/types"
import { defaultCategories } from "@/lib/types"
import { Plus } from "lucide-react"

export default function Home() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [categories, setCategories] = useState<string[]>(defaultCategories)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)

  // Load subscriptions and categories on mount
  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [subsRes, catsRes] = await Promise.all([
        fetch('/api/subscriptions'),
        fetch('/api/categories')
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

  // Filter subscriptions based on selected category and status
  const filteredSubscriptions = subscriptions.filter(sub => {
    const categoryMatch = selectedCategory === 'all' || sub.category === selectedCategory
    const statusMatch = selectedStatus === 'all' || sub.status === selectedStatus
    return categoryMatch && statusMatch
  })

  // Handle form submission (create or update)
  const handleFormSubmit = async (data: SubscriptionFormData) => {
    try {
      if (editingSubscription) {
        // Update existing subscription
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
        }
      } else {
        // Create new subscription
        const response = await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        })
        
        if (response.ok) {
          const newSub = await response.json()
          setSubscriptions(prev => [...prev, newSub])
          
          // Add new category if not exists
          if (!categories.includes(data.category)) {
            setCategories(prev => [...prev, data.category])
          }
        }
      }
    } catch (error) {
      console.error('Failed to save subscription:', error)
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
          <Button onClick={handleAddNew}>
            <Plus className="h-4 w-4 mr-2" />
            添加订阅
          </Button>
        </div>

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
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Subscription List */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold mb-4">订阅列表</h2>
            <SubscriptionList
              subscriptions={filteredSubscriptions}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          </div>

          {/* Pie Chart */}
          <div className="lg:col-span-1">
            <CategoryPieChart subscriptions={subscriptions} />
          </div>
        </div>

        {/* Subscription Form Dialog */}
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