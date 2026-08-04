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
    try {
      const result = processResetTick();
      if (result > 0) {
        console.log("[Scheduler] Processed reset tick");
      }
    } catch (error) {
      console.error("[Scheduler] Reset check failed:", error);
    }

    // Notification tick: detect low-balance threshold transitions and fan-out
    // to configured IM channels. Failures are recorded but never throw.
    try {
      const subscriptions = getSubscriptions();
      await runNotificationTick(subscriptions);
    } catch (error) {
      console.error("[Scheduler] Notification tick failed:", error);
    }
  });

  console.log("[Scheduler] Initialized - running every 5 minutes");
}
