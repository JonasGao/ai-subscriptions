import fs from 'fs'
import path from 'path'
import { PriorityData, PriorityScene } from './types'
import { v4 as uuidv4 } from 'uuid'

const dataDir = path.join(process.cwd(), 'data')
const prioritiesFile = path.join(dataDir, 'priorities.json')

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function getInitialPriorityData(): PriorityData {
  return {
    scenes: []
  }
}

export function readPriorityData(): PriorityData {
  ensureDataDir()
  
  if (!fs.existsSync(prioritiesFile)) {
    const initialData = getInitialPriorityData()
    fs.writeFileSync(prioritiesFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
  
  try {
    const fileContent = fs.readFileSync(prioritiesFile, 'utf-8')
    const data = JSON.parse(fileContent) as PriorityData
    return data
  } catch (error) {
    console.error('Failed to parse priorities file:', error)
    const initialData = getInitialPriorityData()
    fs.writeFileSync(prioritiesFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writePriorityData(data: PriorityData): void {
  ensureDataDir()
  fs.writeFileSync(prioritiesFile, JSON.stringify(data, null, 2))
}

export function getPriorityScenes(): PriorityScene[] {
  const data = readPriorityData()
  return data.scenes
}

export function getPrioritySceneById(id: string): PriorityScene | null {
  const scenes = getPriorityScenes()
  return scenes.find(s => s.id === id) || null
}

export function createPriorityScene(sceneData: { name: string }): PriorityScene {
  if (!sceneData.name || sceneData.name.trim() === '') {
    throw new Error('Scene name is required')
  }
  
  const data = readPriorityData()
  
  if (data.scenes.some(s => s.name === sceneData.name)) {
    throw new Error('Scene name already exists')
  }
  
  const now = new Date().toISOString()
  
  const newScene: PriorityScene = {
    id: uuidv4(),
    name: sceneData.name.trim(),
    subscriptionOrder: [],
    createdAt: now,
    updatedAt: now
  }
  
  data.scenes.push(newScene)
  writePriorityData(data)
  
  return newScene
}

export function updatePriorityScene(
  id: string,
  updates: Partial<Omit<PriorityScene, 'id' | 'createdAt'>>
): PriorityScene | null {
  if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim() === '')) {
    throw new Error('Scene name must be a non-empty string')
  }
  
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === id)
  
  if (index === -1) {
    return null
  }
  
  if (updates.name && data.scenes.some(s => s.id !== id && s.name === updates.name)) {
    throw new Error('Scene name already exists')
  }
  
  data.scenes[index] = {
    ...data.scenes[index],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  
  writePriorityData(data)
  return data.scenes[index]
}

export function deletePriorityScene(id: string): boolean {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === id)
  
  if (index === -1) {
    return false
  }
  
  data.scenes.splice(index, 1)
  writePriorityData(data)
  return true
}

export function addSubscriptionToScene(sceneId: string, subscriptionId: string): PriorityScene | null {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)
  
  if (index === -1) {
    return null
  }
  
  if (data.scenes[index].subscriptionOrder.includes(subscriptionId)) {
    return data.scenes[index]
  }
  
  data.scenes[index].subscriptionOrder.push(subscriptionId)
  data.scenes[index].updatedAt = new Date().toISOString()
  
  writePriorityData(data)
  return data.scenes[index]
}

export function removeSubscriptionFromScene(sceneId: string, subscriptionId: string): PriorityScene | null {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)
  
  if (index === -1) {
    return null
  }
  
  const subIndex = data.scenes[index].subscriptionOrder.indexOf(subscriptionId)
  if (subIndex === -1) {
    return data.scenes[index]
  }
  
  data.scenes[index].subscriptionOrder.splice(subIndex, 1)
  data.scenes[index].updatedAt = new Date().toISOString()
  
  writePriorityData(data)
  return data.scenes[index]
}

export function reorderSubscriptionsInScene(
  sceneId: string,
  subscriptionOrder: string[]
): PriorityScene | null {
  const data = readPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)
  
  if (index === -1) {
    return null
  }
  
  data.scenes[index].subscriptionOrder = subscriptionOrder
  data.scenes[index].updatedAt = new Date().toISOString()
  
  writePriorityData(data)
  return data.scenes[index]
}