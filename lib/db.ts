import fs from 'fs'
import path from 'path'
import { Subscription, SubscriptionData, SubscriptionStatus, SubscriptionType, BillingCycle, defaultCategories, defaultProviders, ResetSchedule } from './types'
import { Provider } from './types'
import { v4 as uuidv4 } from 'uuid'
import { ensureDataDir, atomicWriteFile, dataDir } from './file-ops'
import { encryptApiKey, decryptApiKey } from './encryption'
import { createResetSchedule, updateResetScheduleNextTime } from './reset-schedule'

const dataFile = path.join(dataDir, 'subscriptions.json')
const prioritiesFile = path.join(dataDir, 'priorities.json')

function getInitialData(): SubscriptionData {
  return {
    subscriptions: [],
    categories: defaultCategories
  }
}

export function readData(): SubscriptionData {
  ensureDataDir()

  if (!fs.existsSync(dataFile)) {
    const initialData = getInitialData()
    atomicWriteFile(dataFile, JSON.stringify(initialData, null, 2))
    return initialData
  }

  try {
    const fileContent = fs.readFileSync(dataFile, 'utf-8')
    const data = JSON.parse(fileContent) as SubscriptionData

    data.subscriptions = data.subscriptions.map(sub => ({
      ...sub,
      subscriptionType: sub.subscriptionType || 'recurring',
      billingCycle: sub.billingCycle || 'monthly'
    }))

    let needsWrite = false
    data.subscriptions.forEach(sub => {
      if (sub.apiKey && !sub.apiKey.includes(':')) {
        sub.apiKey = encryptApiKey(sub.apiKey)
        needsWrite = true
      }
    })

    if (needsWrite) {
      atomicWriteFile(dataFile, JSON.stringify(data, null, 2))
    }

    return data
  } catch (error) {
    console.error('Failed to parse data file:', error)
    const initialData = getInitialData()
    atomicWriteFile(dataFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writeData(data: SubscriptionData): void {
  ensureDataDir()
  atomicWriteFile(dataFile, JSON.stringify(data, null, 2))
}

export function getSubscriptions(): Subscription[] {
  const data = readData()
  return data.subscriptions
}

export function getSubscriptionById(id: string): Subscription | null {
  const subscriptions = getSubscriptions()
  return subscriptions.find(s => s.id === id) || null
}

export function createSubscription(subscriptionData: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Subscription {
  if (!subscriptionData.name || subscriptionData.name.trim() === '') {
    throw new Error('Subscription name is required')
  }

  if (typeof subscriptionData.price !== 'number' || subscriptionData.price < 0) {
    throw new Error('Price must be a non-negative number')
  }

  if (subscriptionData.balance !== undefined && (typeof subscriptionData.balance !== 'number' || subscriptionData.balance < 0)) {
    throw new Error('Balance must be a non-negative number')
  }

  const validTypes: SubscriptionType[] = ['recurring', 'one-time']
  if (subscriptionData.subscriptionType && !validTypes.includes(subscriptionData.subscriptionType)) {
    throw new Error('Invalid subscriptionType')
  }

  const validBillingCycles: BillingCycle[] = ['monthly', 'yearly']
  if (subscriptionData.billingCycle && !validBillingCycles.includes(subscriptionData.billingCycle)) {
    throw new Error('Invalid billingCycle')
  }

  if (subscriptionData.subscriptionType === 'recurring' && !subscriptionData.billingCycle) {
    throw new Error('billingCycle is required for recurring subscriptions')
  }

  const data = readData()
  const now = new Date().toISOString()

  const newSubscription: Subscription = {
    ...subscriptionData,
    subscriptionType: subscriptionData.subscriptionType || 'recurring',
    id: uuidv4(),
    createdAt: now,
    updatedAt: now
  }

  if (newSubscription.apiKey) {
    newSubscription.apiKey = encryptApiKey(newSubscription.apiKey)
  }

  data.subscriptions.push(newSubscription)
  writeData(data)

  return newSubscription
}

export function updateSubscription(id: string, updates: Partial<Omit<Subscription, 'id' | 'createdAt'>>): Subscription | null {
  if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim() === '')) {
    throw new Error('Subscription name must be a non-empty string')
  }

  if (updates.price !== undefined && (typeof updates.price !== 'number' || updates.price < 0)) {
    throw new Error('Price must be a non-negative number')
  }

  if (updates.balance !== undefined && (typeof updates.balance !== 'number' || updates.balance < 0)) {
    throw new Error('Balance must be a non-negative number')
  }

  const validStatuses: SubscriptionStatus[] = ['active', 'paused', 'cancelled']
  if (updates.status !== undefined && !validStatuses.includes(updates.status)) {
    throw new Error('Invalid status value')
  }

  const validTypes: SubscriptionType[] = ['recurring', 'one-time']
  if (updates.subscriptionType !== undefined && !validTypes.includes(updates.subscriptionType)) {
    throw new Error('Invalid subscriptionType value')
  }

  const validBillingCycles: BillingCycle[] = ['monthly', 'yearly']
  if (updates.billingCycle !== undefined && !validBillingCycles.includes(updates.billingCycle)) {
    throw new Error('Invalid billingCycle value')
  }

  if (updates.apiKey) {
    updates.apiKey = encryptApiKey(updates.apiKey)
  }

  const data = readData()
  const index = data.subscriptions.findIndex(s => s.id === id)

  if (index === -1) {
    return null
  }

  data.subscriptions[index] = {
    ...data.subscriptions[index],
    ...updates,
    updatedAt: new Date().toISOString()
  }

  writeData(data)
  return data.subscriptions[index]
}

export function deleteSubscription(id: string): boolean {
  const data = readData()
  const index = data.subscriptions.findIndex(s => s.id === id)

  if (index === -1) {
    return false
  }

  data.subscriptions.splice(index, 1)
  writeData(data)

  if (fs.existsSync(prioritiesFile)) {
    try {
      const pRaw = fs.readFileSync(prioritiesFile, 'utf-8')
      const pData = JSON.parse(pRaw)
      let pChanged = false
      pData.scenes?.forEach((scene: { subscriptionOrder: string[] }) => {
        const idx = scene.subscriptionOrder.indexOf(id)
        if (idx !== -1) {
          scene.subscriptionOrder.splice(idx, 1)
          pChanged = true
        }
      })
      if (pChanged) {
        atomicWriteFile(prioritiesFile, JSON.stringify(pData, null, 2))
      }
    } catch {}
  }

  return true
}

export function getCategories(): string[] {
  const data = readData()
  return data.categories
}

export function addCategory(category: string): string[] {
  const data = readData()

  if (data.categories.includes(category)) {
    return data.categories
  }

  data.categories.push(category)
  writeData(data)
  return data.categories
}

export function getProviders(): Provider[] {
  return defaultProviders
}

export function addResetSchedule(subscriptionId: string, scheduleData: {
  type: 'hourly' | 'daily' | 'weekly' | 'monthly'
  enabled?: boolean
  intervalHours?: number
  referenceTime?: string
  timeOfDay?: string
  dayOfWeek?: number
  dayOfMonth?: number
}): ResetSchedule | null {
  const data = readData()
  const index = data.subscriptions.findIndex(s => s.id === subscriptionId)

  if (index === -1) {
    return null
  }

  const schedule = createResetSchedule(scheduleData)
  
  if (!data.subscriptions[index].resetSchedules) {
    data.subscriptions[index].resetSchedules = []
  }
  
  data.subscriptions[index].resetSchedules!.push(schedule)
  data.subscriptions[index].updatedAt = new Date().toISOString()
  
  writeData(data)
  return schedule
}

export function updateResetSchedule(
  subscriptionId: string,
  scheduleId: string,
  updates: Partial<Omit<ResetSchedule, 'id' | 'createdAt'>>
): ResetSchedule | null {
  const data = readData()
  const subIndex = data.subscriptions.findIndex(s => s.id === subscriptionId)

  if (subIndex === -1 || !data.subscriptions[subIndex].resetSchedules) {
    return null
  }

  const scheduleIndex = data.subscriptions[subIndex].resetSchedules!.findIndex(
    s => s.id === scheduleId
  )

  if (scheduleIndex === -1) {
    return null
  }

  const schedule = data.subscriptions[subIndex].resetSchedules![scheduleIndex]
  const updatedSchedule: ResetSchedule = {
    ...schedule,
    ...updates,
    updatedAt: new Date().toISOString()
  }

  if (updates.type || updates.intervalHours || updates.referenceTime || 
      updates.timeOfDay || updates.dayOfWeek || updates.dayOfMonth) {
    const nextReset = updateResetScheduleNextTime(updatedSchedule)
    updatedSchedule.nextResetTime = nextReset.nextResetTime
  }

  data.subscriptions[subIndex].resetSchedules![scheduleIndex] = updatedSchedule
  data.subscriptions[subIndex].updatedAt = new Date().toISOString()
  
  writeData(data)
  return updatedSchedule
}

export function deleteResetSchedule(subscriptionId: string, scheduleId: string): boolean {
  const data = readData()
  const subIndex = data.subscriptions.findIndex(s => s.id === subscriptionId)

  if (subIndex === -1 || !data.subscriptions[subIndex].resetSchedules) {
    return false
  }

  const scheduleIndex = data.subscriptions[subIndex].resetSchedules!.findIndex(
    s => s.id === scheduleId
  )

  if (scheduleIndex === -1) {
    return false
  }

  data.subscriptions[subIndex].resetSchedules!.splice(scheduleIndex, 1)
  data.subscriptions[subIndex].updatedAt = new Date().toISOString()
  
  writeData(data)
  return true
}

export function getSubscriptionsNeedingReset(): Array<{ subscriptionId: string; scheduleId: string }> {
  const data = readData()
  const now = new Date()
  const needsReset: Array<{ subscriptionId: string; scheduleId: string }> = []

  data.subscriptions.forEach(sub => {
    if (!sub.resetSchedules || sub.status !== 'paused') {
      return
    }

    sub.resetSchedules.forEach(schedule => {
      if (!schedule.enabled) {
        return
      }

      const nextReset = new Date(schedule.nextResetTime)
      const diffMs = Math.abs(now.getTime() - nextReset.getTime())
      const diffMinutes = diffMs / (1000 * 60)

      if (diffMinutes < 5) {
        needsReset.push({
          subscriptionId: sub.id,
          scheduleId: schedule.id
        })
      }
    })
  })

  return needsReset
}

export function executeResetsForSubscriptions(
  resets: Array<{ subscriptionId: string; scheduleId: string }>
): number {
  const data = readData()
  const now = new Date().toISOString()
  let count = 0

  resets.forEach(({ subscriptionId, scheduleId }) => {
    const subIndex = data.subscriptions.findIndex(s => s.id === subscriptionId)
    
    if (subIndex === -1 || data.subscriptions[subIndex].status !== 'paused') {
      return
    }

    const scheduleIndex = data.subscriptions[subIndex].resetSchedules?.findIndex(
      s => s.id === scheduleId
    ) ?? -1

    if (scheduleIndex === -1) {
      return
    }

    data.subscriptions[subIndex].status = 'active'
    data.subscriptions[subIndex].updatedAt = now

    const schedule = data.subscriptions[subIndex].resetSchedules![scheduleIndex]
    const nextReset = updateResetScheduleNextTime(schedule)
    data.subscriptions[subIndex].resetSchedules![scheduleIndex] = nextReset

    count++
  })

  if (count > 0) {
    writeData(data)
  }

  return count
}
