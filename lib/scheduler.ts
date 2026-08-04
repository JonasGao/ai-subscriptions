import cron from "node-cron";
import { processResetTick, getSubscriptions } from "./db";
import { runNotificationTick } from "./notifications/dispatcher";

let isInitialized = false;

export function initScheduler() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  cron.schedule("*/5 * * * *", async () => {
    console.log("[Scheduler] Checking for schedules needing reset...");
    let resetTriggers: Awaited<ReturnType<typeof processResetTick>> = [];
    try {
      resetTriggers = processResetTick();
      if (resetTriggers.length > 0) {
        console.log(
          `[Scheduler] Processed reset tick: ${resetTriggers.length} trigger(s)`
        );
      }
    } catch (error) {
      console.error("[Scheduler] Reset check failed:", error);
    }

    // Notification tick: detect low-balance threshold transitions and
    // dispatch reset notifications. Failures are recorded but never throw.
    try {
      const subscriptions = getSubscriptions();
      await runNotificationTick(subscriptions, undefined, resetTriggers);
    } catch (error) {
      console.error("[Scheduler] Notification tick failed:", error);
    }
  });

  console.log("[Scheduler] Initialized - running every 5 minutes");
}
