import fs from 'fs'
import path from 'path'
import { Tool, ToolData } from './types'
import { v4 as uuidv4 } from 'uuid'

const dataDir = path.join(process.cwd(), 'data')
const toolsFile = path.join(dataDir, 'tools.json')

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function getInitialToolData(): ToolData {
  return {
    tools: []
  }
}

export function readToolData(): ToolData {
  ensureDataDir()
  
  if (!fs.existsSync(toolsFile)) {
    const initialData = getInitialToolData()
    fs.writeFileSync(toolsFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
  
  try {
    const fileContent = fs.readFileSync(toolsFile, 'utf-8')
    const data = JSON.parse(fileContent) as ToolData
    return data
  } catch (error) {
    console.error('Failed to parse tools file:', error)
    const initialData = getInitialToolData()
    fs.writeFileSync(toolsFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
}

export function writeToolData(data: ToolData): void {
  ensureDataDir()
  fs.writeFileSync(toolsFile, JSON.stringify(data, null, 2))
}

export function getTools(): Tool[] {
  const data = readToolData()
  return data.tools
}

export function getToolById(id: string): Tool | null {
  const tools = getTools()
  return tools.find(t => t.id === id) || null
}

export function createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Tool {
  if (!toolData.name || toolData.name.trim() === '') {
    throw new Error('Tool name is required')
  }
  
  const data = readToolData()
  const now = new Date().toISOString()
  
  const newTool: Tool = {
    ...toolData,
    id: uuidv4(),
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
  return true
}