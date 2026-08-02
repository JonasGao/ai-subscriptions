import cron from "node-cron";
import { processResetTick } from "./db";

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
  });

  console.log("[Scheduler] Initialized - running every 5 minutes");
}
