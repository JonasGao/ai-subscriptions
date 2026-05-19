import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Subscription } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateMonthlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status === 'active')
    .reduce((total, s) => total + s.price, 0)
}

export function calculateYearlyTotal(subscriptions: Subscription[]): number {
  return calculateMonthlyTotal(subscriptions) * 12
}

export function calculateCategoryStats(subscriptions: Subscription[]): Record<string, number> {
  const stats: Record<string, number> = {}
  
  subscriptions
    .filter(s => s.status === 'active')
    .forEach(s => {
      if (!stats[s.category]) {
        stats[s.category] = 0
      }
      stats[s.category] += s.price
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