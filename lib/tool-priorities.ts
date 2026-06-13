import path from 'path'
import { ToolPriorityData, ToolPriorityScene } from './types'
import { createSceneManager } from './priority-scene'

const toolPrioritiesFile = path.join(process.cwd(), 'data', 'tool-priorities.json')

const manager = createSceneManager<ToolPriorityScene>({
  filePath: toolPrioritiesFile,
  orderField: 'toolOrder',
  getInitialData: (): ToolPriorityData => ({ scenes: [] })
})

export const readToolPriorityData = manager.readData
export const getToolPriorityScenes = manager.getScenes
export const getToolPrioritySceneById = manager.getSceneById
export const createToolPriorityScene = manager.createScene
export const updateToolPriorityScene = manager.updateScene
export const deleteToolPriorityScene = manager.deleteScene
export const addToolToScene = manager.addItemToScene
export const removeToolFromScene = manager.removeItemFromScene
export const reorderToolsInScene = manager.reorderItemsInScene
