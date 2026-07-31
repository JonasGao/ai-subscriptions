import cron from 'node-cron'
import fs from 'fs'
import path from 'path'
import { resetPausedSubscriptions } from './db'
import { ensureDataDir, dataDir } from './file-ops'

const lastResetFile = path.join(dataDir, 'last-monthly-reset.json')

let isInitialized = false

export function initScheduler() {
  if (isInitialized) {
    return
  }

  isInitialized = true

  // 每月1号 00:00 执行
  cron.schedule('0 0 1 * *', async () => {
    console.log('[Scheduler] Monthly reset started')
    try {
      const count = resetPausedSubscriptions()
      console.log(`[Scheduler] Reset ${count} subscriptions to active`)
      saveLastResetTime()
    } catch (error) {
      console.error('[Scheduler] Monthly reset failed:', error)
    }
  })

  // 启动补偿：检查是否需要立即执行
  checkAndExecuteMissedReset()
}

function getLastResetTime(): string | null {
  try {
    if (fs.existsSync(lastResetFile)) {
      const content = fs.readFileSync(lastResetFile, 'utf-8')
      const data = JSON.parse(content)
      return data.lastReset || null
    }
  } catch (error) {
    console.error('[Scheduler] Failed to read last reset time:', error)
  }
  return null
}

function saveLastResetTime() {
  try {
    ensureDataDir()
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    fs.writeFileSync(lastResetFile, JSON.stringify({ lastReset: yearMonth }))
  } catch (error) {
    console.error('[Scheduler] Failed to save last reset time:', error)
  }
}

function checkAndExecuteMissedReset() {
  const now = new Date()
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const lastReset = getLastResetTime()

  if (!lastReset) {
    // 首次运行，执行重置
    executeReset(currentYearMonth)
    return
  }

  if (lastReset !== currentYearMonth) {
    // 错过了执行，立即补偿
    console.log(`[Scheduler] Missed reset detected. Last: ${lastReset}, Current: ${currentYearMonth}`)
    executeReset(currentYearMonth)
  }
}

function executeReset(yearMonth: string) {
  try {
    const count = resetPausedSubscriptions()
    console.log(`[Scheduler] Compensation reset: ${count} subscriptions reset to active`)
    saveLastResetTime()
  } catch (error) {
    console.error('[Scheduler] Compensation reset failed:', error)
  }
}
