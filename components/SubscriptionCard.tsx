"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Subscription, defaultProviders } from "@/lib/types"
import { formatDate, isExpiringSoon, getDaysUntilRenewal } from "@/lib/utils"
import { Edit, Trash2 } from "lucide-react"

interface SubscriptionCardProps {
  subscription: Subscription
  onEdit: (subscription: Subscription) => void
  onDelete: (id: string) => void
}

function getStatusBadgeVariant(status: Subscription['status']): "success" | "warning" | "outline" {
  switch (status) {
    case 'active':
      return 'success'
    case 'paused':
      return 'warning'
    case 'cancelled':
      return 'outline'
    default:
      return 'outline'
  }
}

function getStatusLabel(status: Subscription['status']): string {
  switch (status) {
    case 'active':
      return '活跃'
    case 'paused':
      return '暂停'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

function getProviderName(provider: string, providerCustom?: string): string {
  if (provider === 'other' && providerCustom) {
    return providerCustom
  }
  const found = defaultProviders.find(p => p.id === provider)
  return found?.name || provider
}

function getTypeLabel(type: string): string {
  return type === 'recurring' ? '周期性' : '一次性'
}

export function SubscriptionCard({ subscription, onEdit, onDelete }: SubscriptionCardProps) {
  const isRecurring = subscription.subscriptionType === 'recurring'
  const expiringSoon = isRecurring && subscription.renewalDate ? isExpiringSoon(subscription.renewalDate) : false
  const daysUntilRenewal = isRecurring && subscription.renewalDate ? getDaysUntilRenewal(subscription.renewalDate) : null
  const providerName = getProviderName(subscription.provider, subscription.providerCustom)
  const typeLabel = getTypeLabel(subscription.subscriptionType)
  const priceLabel = subscription.subscriptionType === 'one-time' 
    ? `¥${subscription.price.toFixed(2)}` 
    : subscription.billingCycle === 'yearly' 
      ? `¥${subscription.price.toFixed(2)}/年` 
      : `¥${subscription.price.toFixed(2)}/月`
  
  return (
    <Card className={`flex flex-col ${expiringSoon ? 'border-orange-500 border-2' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-medium">{subscription.name}</CardTitle>
        <Badge variant={getStatusBadgeVariant(subscription.status)}>
          {getStatusLabel(subscription.status)}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        <div className="space-y-2 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">提供商</span>
            <span className="text-sm font-medium">{providerName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">分类</span>
            <span className="text-sm font-medium">{subscription.category}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">类型</span>
            <Badge variant="outline" className="text-xs">{typeLabel}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{isRecurring ? '价格' : '充值金额'}</span>
            <span className="text-sm font-medium">{priceLabel}</span>
          </div>
          {isRecurring && subscription.renewalDate && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">续费日期</span>
              <span className={`text-sm font-medium ${expiringSoon ? 'text-orange-500' : ''}`}>
                {formatDate(subscription.renewalDate)}
                {expiringSoon && daysUntilRenewal !== null && (
                  <span className="ml-1">({daysUntilRenewal}天后)</span>
                )}
              </span>
            </div>
          )}
          {subscription.notes && (
            <div className="pt-2">
              <span className="text-sm text-muted-foreground">备注</span>
              <p className="text-sm mt-1">{subscription.notes}</p>
            </div>
          )}
        </div>
        <div className="flex gap-2 pt-4 mt-auto">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onEdit(subscription)}
          >
            <Edit className="h-4 w-4 mr-1" />
            编辑
          </Button>
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={() => onDelete(subscription.id)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}