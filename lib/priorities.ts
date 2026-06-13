import path from 'path'
import { PriorityData, PriorityScene } from './types'
import { createSceneManager } from './priority-scene'

const prioritiesFile = path.join(process.cwd(), 'data', 'priorities.json')

const manager = createSceneManager<PriorityScene>({
  filePath: prioritiesFile,
  orderField: 'subscriptionOrder',
  getInitialData: (): PriorityData => ({ scenes: [] })
})

export const readPriorityData = manager.readData
export const getPriorityScenes = manager.getScenes
export const getPrioritySceneById = manager.getSceneById
export const createPriorityScene = manager.createScene
export const updatePriorityScene = manager.updateScene
export const deletePriorityScene = manager.deleteScene
export const addSubscriptionToScene = manager.addItemToScene
export const removeSubscriptionFromScene = manager.removeItemFromScene
export const reorderSubscriptionsInScene = manager.reorderItemsInScene
