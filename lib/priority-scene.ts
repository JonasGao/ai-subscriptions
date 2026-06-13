import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { ensureDataDir, atomicWriteFile } from './file-ops'

export interface BaseScene {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface SceneConfig<T extends BaseScene> {
  filePath: string
  orderField: string
  getInitialData: () => { scenes: T[] }
}

export function createSceneManager<T extends BaseScene>(config: SceneConfig<T>) {
  const { filePath, orderField } = config

  function readData(): { scenes: T[] } {
    ensureDataDir()

    if (!fs.existsSync(filePath)) {
      const initialData = config.getInitialData()
      atomicWriteFile(filePath, JSON.stringify(initialData, null, 2))
      return initialData
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(fileContent) as { scenes: T[] }
    } catch (error) {
      console.error(`Failed to parse ${filePath}:`, error)
      const initialData = config.getInitialData()
      atomicWriteFile(filePath, JSON.stringify(initialData, null, 2))
      return initialData
    }
  }

  function writeData(data: { scenes: T[] }): void {
    atomicWriteFile(filePath, JSON.stringify(data, null, 2))
  }

  function getScenes(): T[] {
    return readData().scenes
  }

  function getSceneById(id: string): T | null {
    return getScenes().find(s => s.id === id) || null
  }

  function createScene(sceneData: { name: string }): T {
    if (!sceneData.name || sceneData.name.trim() === '') {
      throw new Error('Scene name is required')
    }

    const data = readData()

    if (data.scenes.some(s => s.name === sceneData.name)) {
      throw new Error('Scene name already exists')
    }

    const now = new Date().toISOString()

    const newScene: T = {
      id: uuidv4(),
      name: sceneData.name.trim(),
      createdAt: now,
      updatedAt: now,
    } as T
    ;(newScene as unknown as Record<string, unknown>)[orderField] = []

    data.scenes.push(newScene)
    writeData(data)

    return newScene
  }

  function updateScene(id: string, updates: Partial<Omit<T, 'id' | 'createdAt'>>): T | null {
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim() === '')) {
      throw new Error('Scene name must be a non-empty string')
    }

    const data = readData()
    const index = data.scenes.findIndex(s => s.id === id)

    if (index === -1) {
      return null
    }

    if ((updates as Record<string, unknown>).name && data.scenes.some(s => s.id !== id && s.name === (updates as Record<string, unknown>).name)) {
      throw new Error('Scene name already exists')
    }

    data.scenes[index] = {
      ...data.scenes[index],
      ...updates,
      updatedAt: new Date().toISOString()
    }

    writeData(data)
    return data.scenes[index]
  }

  function deleteScene(id: string): boolean {
    const data = readData()
    const index = data.scenes.findIndex(s => s.id === id)

    if (index === -1) {
      return false
    }

    data.scenes.splice(index, 1)
    writeData(data)
    return true
  }

  function addItemToScene(sceneId: string, itemId: string): T | null {
    const data = readData()
    const index = data.scenes.findIndex(s => s.id === sceneId)

    if (index === -1) {
      return null
    }

    const order = (data.scenes[index] as Record<string, unknown>)[orderField] as string[]
    if (!order.includes(itemId)) {
      order.push(itemId)
      data.scenes[index].updatedAt = new Date().toISOString()
      writeData(data)
    }

    return data.scenes[index]
  }

  function removeItemFromScene(sceneId: string, itemId: string): T | null {
    const data = readData()
    const index = data.scenes.findIndex(s => s.id === sceneId)

    if (index === -1) {
      return null
    }

    const order = (data.scenes[index] as Record<string, unknown>)[orderField] as string[]
    const itemIndex = order.indexOf(itemId)
    if (itemIndex !== -1) {
      order.splice(itemIndex, 1)
      data.scenes[index].updatedAt = new Date().toISOString()
      writeData(data)
    }

    return data.scenes[index]
  }

  function reorderItemsInScene(sceneId: string, itemOrder: string[]): T | null {
    const data = readData()
    const index = data.scenes.findIndex(s => s.id === sceneId)

    if (index === -1) {
      return null
    }

    ;(data.scenes[index] as Record<string, unknown>)[orderField] = itemOrder
    data.scenes[index].updatedAt = new Date().toISOString()
    writeData(data)
    return data.scenes[index]
  }

  return {
    readData,
    getScenes,
    getSceneById,
    createScene,
    updateScene,
    deleteScene,
    addItemToScene,
    removeItemFromScene,
    reorderItemsInScene,
  }
}
