"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Subscription, SubscriptionFormData, SubscriptionStatus, SubscriptionType, BillingCycle, defaultCategories, Provider, defaultProviders } from "@/lib/types"

interface SubscriptionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription?: Subscription | null
  categories: string[]
  onSubmit: (data: SubscriptionFormData) => void
}

const initialFormData: SubscriptionFormData = {
  name: '',
  category: defaultCategories[0],
  provider: 'other',
  providerCustom: '',
  subscriptionType: 'recurring',
  billingCycle: 'monthly',
  price: 0,
  startDate: '',
  renewalDate: '',
  status: 'active',
  notes: '',
  apiKey: '',
  balance: undefined
}

export function SubscriptionForm({
  open,
  onOpenChange,
  subscription,
  categories,
  onSubmit,
}: SubscriptionFormProps) {
  const [formData, setFormData] = useState<SubscriptionFormData>(initialFormData)
  const [providers, setProviders] = useState<Provider[]>(defaultProviders)
  
  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.json())
      .then(data => setProviders(data))
      .catch(() => setProviders(defaultProviders))
  }, [])
  
  useEffect(() => {
    if (subscription) {
      setFormData({
        name: subscription.name,
        category: subscription.category,
        provider: subscription.provider || 'other',
        providerCustom: subscription.providerCustom || '',
        subscriptionType: subscription.subscriptionType || 'recurring',
        billingCycle: subscription.billingCycle || 'monthly',
        price: subscription.price,
        startDate: subscription.startDate || '',
        renewalDate: subscription.renewalDate || '',
        status: subscription.status,
        notes: subscription.notes || '',
        apiKey: '',
        balance: subscription.balance,
      })
    } else {
      setFormData(initialFormData)
    }
  }, [subscription, open])
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
    onOpenChange(false)
  }
  
  const handleInputChange = (field: keyof SubscriptionFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }
  
  const showCustomProvider = formData.provider === 'other'
  const isRecurring = formData.subscriptionType === 'recurring'
  const billingCycle = formData.billingCycle || 'monthly'
  
  const priceLabel = isRecurring 
    ? (billingCycle === 'yearly' ? '价格 (¥/年)' : '价格 (¥/月)')
    : '充值金额 (¥)'
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {subscription ? '编辑订阅' : '添加订阅'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-3 py-3">
            <div className="grid gap-2">
              <Label htmlFor="name">名称 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="输入订阅名称"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="category">分类 *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => handleInputChange('category', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="provider">提供商 *</Label>
                <Select
                  value={formData.provider}
                  onValueChange={(value) => handleInputChange('provider', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择提供商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {showCustomProvider && (
              <div className="grid gap-2">
                <Label htmlFor="providerCustom">自定义提供商名称 *</Label>
                <Input
                  id="providerCustom"
                  value={formData.providerCustom}
                  onChange={(e) => handleInputChange('providerCustom', e.target.value)}
                  placeholder="输入自定义提供商名称"
                  required={showCustomProvider}
                />
              </div>
            )}
            {formData.provider === 'deepseek' && (
              <div className="grid gap-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={formData.apiKey || ''}
                  onChange={(e) => handleInputChange('apiKey', e.target.value)}
                  placeholder={subscription ? '已配置，留空保持不变' : '输入 DeepSeek API Key'}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="subscriptionType">订阅类型 *</Label>
                <Select
                  value={formData.subscriptionType}
                  onValueChange={(value) => handleInputChange('subscriptionType', value as SubscriptionType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recurring">周期性</SelectItem>
                    <SelectItem value="one-time">一次性</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isRecurring ? (
                <div className="grid gap-2">
                  <Label htmlFor="billingCycle">计费周期 *</Label>
                  <Select
                    value={billingCycle}
                    onValueChange={(value) => handleInputChange('billingCycle', value as BillingCycle)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择周期" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">月度</SelectItem>
                      <SelectItem value="yearly">年度</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="status">状态</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleInputChange('status', value as SubscriptionStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">活跃</SelectItem>
                      <SelectItem value="paused">暂停</SelectItem>
                      <SelectItem value="cancelled">已取消</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="price">{priceLabel} *</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => handleInputChange('price', parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  required
                />
              </div>
              {isRecurring && (
                <div className="grid gap-2">
                  <Label htmlFor="status">状态</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleInputChange('status', value as SubscriptionStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">活跃</SelectItem>
                      <SelectItem value="paused">暂停</SelectItem>
                      <SelectItem value="cancelled">已取消</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {!isRecurring && formData.provider !== 'deepseek' && formData.provider !== 'moonshot' && (
              <div className="grid gap-2">
                <Label htmlFor="balance">余额 (¥)</Label>
                <Input
                  id="balance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.balance ?? ''}
                  onChange={(e) => handleInputChange('balance', e.target.value ? parseFloat(e.target.value) : 0)}
                  placeholder="手动输入余额"
                />
              </div>
            )}
            {isRecurring && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="startDate">开始日期 *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={formData.startDate || ''}
                    onChange={(e) => handleInputChange('startDate', e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="renewalDate">续费日期 *</Label>
                  <Input
                    id="renewalDate"
                    type="date"
                    value={formData.renewalDate || ''}
                    onChange={(e) => handleInputChange('renewalDate', e.target.value)}
                    required
                  />
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="notes">备注</Label>
              <Input
                id="notes"
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="可选备注信息"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">
              {subscription ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}