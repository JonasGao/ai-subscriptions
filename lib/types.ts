export interface Subscription {
  id: string
  name: string
  category: string
  price: number
  startDate: string
  renewalDate: string
  status: 'active' | 'paused' | 'cancelled'
  notes?: string
  createdAt: string
  updatedAt: string
}

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'

export interface SubscriptionData {
  subscriptions: Subscription[]
  categories: string[]
}

export const defaultCategories: string[] = [
  'AI助手',
  '图像生成',
  '代码工具',
  '写作工具',
  '数据分析',
  '其他'
]

export interface SubscriptionFormData {
  name: string
  category: string
  price: number
  startDate: string
  renewalDate: string
  status: SubscriptionStatus
  notes?: string
}