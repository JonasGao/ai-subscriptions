import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Subscription } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateMonthlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status === 'active' && s.subscriptionType === 'recurring')
    .reduce((total, s) => {
      const monthlyPrice = s.billingCycle === 'yearly' 
        ? s.price / 12 
        : s.price
      return total + monthlyPrice
    }, 0)
}

export function calculateYearlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status === 'active' && s.subscriptionType === 'recurring')
    .reduce((total, s) => {
      const yearlyPrice = s.billingCycle === 'monthly' 
        ? s.price * 12 
        : s.price
      return total + yearlyPrice
    }, 0)
}

export function calculateOneTimeTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status === 'active' && s.subscriptionType === 'one-time')
    .reduce((total, s) => total + s.price, 0)
}

export function calculateCategoryStats(subscriptions: Subscription[]): Record<string, number> {
  const stats: Record<string, number> = {}
  
  subscriptions
    .filter(s => s.status === 'active')
    .forEach(s => {
      if (!stats[s.category]) {
        stats[s.category] = 0
      }
      if (s.subscriptionType === 'recurring') {
        const monthlyPrice = s.billingCycle === 'yearly' 
          ? s.price / 12 
          : s.price
        stats[s.category] += monthlyPrice
      } else {
        stats[s.category] += s.price
      }
    })
  
  return stats
}

export function getDaysUntilRenewal(renewalDate: string): number {
  const renewal = new Date(renewalDate)
  const today = new Date()
  const diffTime = renewal.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}

export function isExpiringSoon(renewalDate: string): boolean {
  const days = getDaysUntilRenewal(renewalDate)
  return days >= 0 && days <= 7
}

export function formatDate(dateString?: string): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function formatNextResetTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMins / 60)
  const remainingMins = diffMins % 60
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 0) {
    return '已过期'
  } else if (diffMins < 60) {
    return `${diffMins}分钟后重置`
  } else if (diffHours < 24) {
    if (remainingMins === 0) {
      return `${diffHours}小时后重置`
    }
    return `${diffHours}小时${remainingMins}分钟后重置`
  } else {
    const remainingHours = diffHours % 24
    if (remainingHours === 0 && remainingMins === 0) {
      return `${diffDays}天后重置 (${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    } else if (remainingMins === 0) {
      return `${diffDays}天${remainingHours}小时后重置 (${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    } else if (remainingHours === 0) {
      return `${diffDays}天${remainingMins}分钟后重置 (${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    }
    return `${diffDays}天${remainingHours}小时${remainingMins}分钟后重置 (${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
  }
}

export function getScheduleTypeLabel(type: string): string {
  switch (type) {
    case 'hourly':
      return '每N小时'
    case 'daily':
      return '每日'
    case 'weekly':
      return '每周'
    case 'monthly':
      return '每月'
    default:
      return type
  }
}