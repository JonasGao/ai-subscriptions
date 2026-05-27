import fs from 'fs'
import path from 'path'
import { ToolPriorityData, ToolPriorityScene } from './types'
import { v4 as uuidv4 } from 'uuid'

const dataDir = path.join(process.cwd(), 'data')
const toolPrioritiesFile = path.join(dataDir, 'tool-priorities.json')

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function getInitialToolPriorityData(): ToolPriorityData {
  return {
    scenes: []
  }
}

export function readToolPriorityData(): ToolPriorityData {
  ensureDataDir()

  if (!fs.existsSync(toolPrioritiesFile)) {
    const initialData = getInitialToolPriorityData()
    fs.writeFileSync(toolPrioritiesFile, JSON.stringify(initialData, null, 2))
    return initialData
  }

  try {
    const fileContent = fs.readFileSync(toolPrioritiesFile, 'utf-8')
    const data = JSON.parse(fileContent) as ToolPriorityData
    return data
  } catch (error) {
    console.error('Failed to parse tool-priorities file:', error)
    const initialData = getInitialToolPriorityData()
    fs.writeFileSync(toolPrioritiesFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writeToolPriorityData(data: ToolPriorityData): void {
  ensureDataDir()
  fs.writeFileSync(toolPrioritiesFile, JSON.stringify(data, null, 2))
}

export function getToolPriorityScenes(): ToolPriorityScene[] {
  const data = readToolPriorityData()
  return data.scenes
}

export function getToolPrioritySceneById(id: string): ToolPriorityScene | null {
  const scenes = getToolPriorityScenes()
  return scenes.find(s => s.id === id) || null
}

export function createToolPriorityScene(sceneData: { name: string }): ToolPriorityScene {
  if (!sceneData.name || sceneData.name.trim() === '') {
    throw new Error('Scene name is required')
  }

  const data = readToolPriorityData()

  if (data.scenes.some(s => s.name === sceneData.name)) {
    throw new Error('Scene name already exists')
  }

  const now = new Date().toISOString()

  const newScene: ToolPriorityScene = {
    id: uuidv4(),
    name: sceneData.name.trim(),
    toolOrder: [],
    createdAt: now,
    updatedAt: now
  }

  data.scenes.push(newScene)
  writeToolPriorityData(data)

  return newScene
}

export function updateToolPriorityScene(
  id: string,
  updates: Partial<Omit<ToolPriorityScene, 'id' | 'createdAt'>>
): ToolPriorityScene | null {
  if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim() === '')) {
    throw new Error('Scene name must be a non-empty string')
  }

  const data = readToolPriorityData()
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

  writeToolPriorityData(data)
  return data.scenes[index]
}

export function deleteToolPriorityScene(id: string): boolean {
  const data = readToolPriorityData()
  const index = data.scenes.findIndex(s => s.id === id)

  if (index === -1) {
    return false
  }

  data.scenes.splice(index, 1)
  writeToolPriorityData(data)
  return true
}

export function addToolToScene(sceneId: string, toolId: string): ToolPriorityScene | null {
  const data = readToolPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)

  if (index === -1) {
    return null
  }

  if (data.scenes[index].toolOrder.includes(toolId)) {
    return data.scenes[index]
  }

  data.scenes[index].toolOrder.push(toolId)
  data.scenes[index].updatedAt = new Date().toISOString()

  writeToolPriorityData(data)
  return data.scenes[index]
}

export function removeToolFromScene(sceneId: string, toolId: string): ToolPriorityScene | null {
  const data = readToolPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)

  if (index === -1) {
    return null
  }

  const toolIndex = data.scenes[index].toolOrder.indexOf(toolId)
  if (toolIndex === -1) {
    return data.scenes[index]
  }

  data.scenes[index].toolOrder.splice(toolIndex, 1)
  data.scenes[index].updatedAt = new Date().toISOString()

  writeToolPriorityData(data)
  return data.scenes[index]
}

export function reorderToolsInScene(
  sceneId: string,
  toolOrder: string[]
): ToolPriorityScene | null {
  const data = readToolPriorityData()
  const index = data.scenes.findIndex(s => s.id === sceneId)

  if (index === -1) {
    return null
  }

  data.scenes[index].toolOrder = toolOrder
  data.scenes[index].updatedAt = new Date().toISOString()

  writeToolPriorityData(data)
  return data.scenes[index]
}
