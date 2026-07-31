import cron from 'node-cron'
import { getSubscriptionsNeedingReset, executeResetsForSubscriptions } from './db'

let isInitialized = false

export function initScheduler() {
  if (isInitialized) {
    return
  }

  isInitialized = true

  cron.schedule('*/5 * * * *', async () => {
    console.log('[Scheduler] Checking for subscriptions needing reset...')
    try {
      const resets = getSubscriptionsNeedingReset()
      
      if (resets.length === 0) {
        return
      }

      console.log(`[Scheduler] Found ${resets.length} subscriptions to reset`)
      const count = executeResetsForSubscriptions(resets)
      console.log(`[Scheduler] Reset ${count} subscriptions to active`)
    } catch (error) {
      console.error('[Scheduler] Reset check failed:', error)
    }
  })

  console.log('[Scheduler] Initialized - running every 5 minutes')
}