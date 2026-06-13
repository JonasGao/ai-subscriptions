import fs from 'fs'
import path from 'path'
import { Tool, ToolData } from './types'
import { v4 as uuidv4 } from 'uuid'
import { ensureDataDir, atomicWriteFile } from './file-ops'

const dataDir = path.join(process.cwd(), 'data')
const toolsFile = path.join(dataDir, 'tools.json')
const toolPrioritiesFile = path.join(dataDir, 'tool-priorities.json')

function getInitialToolData(): ToolData {
  return {
    tools: []
  }
}

export function readToolData(): ToolData {
  ensureDataDir()

  if (!fs.existsSync(toolsFile)) {
    const initialData = getInitialToolData()
    atomicWriteFile(toolsFile, JSON.stringify(initialData, null, 2))
    return initialData
  }

  try {
    const fileContent = fs.readFileSync(toolsFile, 'utf-8')
    const data = JSON.parse(fileContent) as ToolData
    return data
  } catch (error) {
    console.error('Failed to parse tools file:', error)
    const initialData = getInitialToolData()
    atomicWriteFile(toolsFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writeToolData(data: ToolData): void {
  ensureDataDir()
  atomicWriteFile(toolsFile, JSON.stringify(data, null, 2))
}

export function getTools(): Tool[] {
  const data = readToolData()
  return data.tools.sort((a, b) => (a.order || 0) - (b.order || 0))
}

export function getToolById(id: string): Tool | null {
  const tools = getTools()
  return tools.find(t => t.id === id) || null
}

export function createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Tool {
  if (!toolData.name || toolData.name.trim() === '') {
    throw new Error('Tool name is required')
  }

  const data = readToolData()
  const now = new Date().toISOString()
  const maxOrder = data.tools.reduce((max, t) => Math.max(max, t.order || 0), 0)

  const newTool: Tool = {
    ...toolData,
    id: uuidv4(),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now
  }

  data.tools.push(newTool)
  writeToolData(data)

  return newTool
}

export function updateTool(id: string, updates: Partial<Omit<Tool, 'id' | 'createdAt'>>): Tool | null {
  if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim() === '')) {
    throw new Error('Tool name must be a non-empty string')
  }

  const data = readToolData()
  const index = data.tools.findIndex(t => t.id === id)

  if (index === -1) {
    return null
  }

  data.tools[index] = {
    ...data.tools[index],
    ...updates,
    updatedAt: new Date().toISOString()
  }

  writeToolData(data)
  return data.tools[index]
}

export function deleteTool(id: string): boolean {
  const data = readToolData()
  const index = data.tools.findIndex(t => t.id === id)

  if (index === -1) {
    return false
  }

  data.tools.splice(index, 1)
  writeToolData(data)

  if (fs.existsSync(toolPrioritiesFile)) {
    try {
      const tpRaw = fs.readFileSync(toolPrioritiesFile, 'utf-8')
      const tpData = JSON.parse(tpRaw)
      let tpChanged = false
      tpData.scenes?.forEach((scene: { toolOrder: string[] }) => {
        const idx = scene.toolOrder.indexOf(id)
        if (idx !== -1) {
          scene.toolOrder.splice(idx, 1)
          tpChanged = true
        }
      })
      if (tpChanged) {
        atomicWriteFile(toolPrioritiesFile, JSON.stringify(tpData, null, 2))
      }
    } catch {}
  }

  return true
}

export function reorderTools(toolIds: string[]): Tool[] {
  const data = readToolData()

  toolIds.forEach((id, index) => {
    const tool = data.tools.find(t => t.id === id)
    if (tool) {
      tool.order = index
      tool.updatedAt = new Date().toISOString()
    }
  })

  data.tools.sort((a, b) => a.order - b.order)
  writeToolData(data)

  return data.tools
}
