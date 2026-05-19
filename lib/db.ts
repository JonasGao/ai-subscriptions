import fs from 'fs'
import path from 'path'
import { Subscription, SubscriptionData, defaultCategories } from './types'
import { v4 as uuidv4 } from 'uuid'

const dataDir = path.join(process.cwd(), 'data')
const dataFile = path.join(dataDir, 'subscriptions.json')

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

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
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
  
  try {
    const fileContent = fs.readFileSync(dataFile, 'utf-8')
    return JSON.parse(fileContent) as SubscriptionData
  } catch (error) {
    console.error('Failed to parse data file:', error)
    const initialData = getInitialData()
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writeData(data: SubscriptionData): void {
  ensureDataDir()
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2))
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
  
  const data = readData()
  const now = new Date().toISOString()
  
  const newSubscription: Subscription = {
    ...subscriptionData,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now
  }
  
  data.subscriptions.push(newSubscription)
  writeData(data)
  
  return newSubscription
}

export function updateSubscription(id: string, updates: Partial<Omit<Subscription, 'id' | 'createdAt'>>): Subscription | null {
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