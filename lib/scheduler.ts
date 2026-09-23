import cron from "node-cron";
import { processResetTick, getSubscriptions } from "./db";
import { runNotificationTick } from "./notifications/dispatcher";
import { alignResetTimes } from "./reset-alignment";
import type { ResetTickTrigger } from "./types";

let isInitialized = false;

export function initScheduler() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  cron.schedule("*/5 * * * *", async () => {
    console.log("[Scheduler] Checking for schedules needing reset...");
    let resetTriggers: ResetTickTrigger[] = [];
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

    // Notification tick: dispatch reset events first, then detect low-balance
    // threshold transitions. Failures are recorded but never throw.
    try {
      const subscriptions = getSubscriptions();
      await runNotificationTick({ subscriptions, resetTriggers });
    } catch (error) {
      console.error("[Scheduler] Notification tick failed:", error);
    }

    // Reset-time alignment: query the provider for the real reset time and
    // overwrite nextResetTime for every schedule on triggered subscriptions.
    // Runs after notifications — alignment never blocks / changes them.
    try {
      await alignResetTimes(resetTriggers);
    } catch (error) {
      console.error("[Scheduler] Reset-time alignment failed:", error);
    }
  });

  console.log("[Scheduler] Initialized - running every 5 minutes");
}
