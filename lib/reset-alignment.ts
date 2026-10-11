import { readData, writeData } from "./db";
import { decryptCredentials } from "./encryption";
import { resolveUsageHandler } from "./providers";
import {
  extractDayOfMonthFromDate,
  extractDayOfWeekFromDate,
  extractTimeOfDayFromDate,
} from "./reset-schedule";
import type {
  ResetTickTrigger,
  ResetScheduleType,
  Subscription,
  UsageResult,
  UsageWindow,
  ResetSchedule,
} from "./types";

type UsageBucketKey = "fiveHour" | "weekly" | "monthly";

/**
 * Maps each ResetScheduleType to the matching UsageResult bucket.
 * The names align 1:1 by design (see ADR-0014 / Reset-Time Alignment).
 */
const BUCKET_BY_TYPE: Record<ResetScheduleType, UsageBucketKey> = {
  fiveHour: "fiveHour",
  weekly: "weekly",
  monthly: "monthly",
};

interface CalibrationCandidate {
  subId: string;
  scheduleId: string;
  newResetTime: string;
  /** Reverse-derived schedule config (absent for fiveHour — see ADR-0016). */
  timeOfDay?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

/** Skip-log helper: keeps every skip message byte-identical to the spec. */
function skipInfo(
  sub: { name: string; id: string },
  reason: string,
  schedulePart?: string
): void {
  const tail = schedulePart ? ` ${schedulePart}: ${reason}` : `: ${reason}`;
  console.info(
    `[Scheduler] Reset-time calibration skipped for ${sub.name}(${sub.id})${tail}`
  );
}

/**
 * Per-schedule calibration candidates from an already-fetched UsageResult.
 * Pure w.r.t. persistence: takes the subscription object, never reads disk.
 *
 * Beyond overwriting nextResetTime (ADR-0014), weekly/monthly schedules get
 * their cycle config reverse-derived from the API reset time in the
 * schedule's own timezone (ADR-0016). fiveHour has no derivable fields —
 * its anchor IS nextResetTime.
 */
function computeCandidates(
  sub: Subscription,
  result: UsageResult,
  now: Date
): CalibrationCandidate[] {
  const candidates: CalibrationCandidate[] = [];

  // One fetch covers ALL enabled schedules on this subscription.
  for (const schedule of sub.resetSchedules ?? []) {
    if (!schedule.enabled) continue;
    const bucketKey = BUCKET_BY_TYPE[schedule.type];
    const bucket: UsageWindow | null = result[bucketKey];
    if (!bucket || !bucket.resetTime) {
      skipInfo(sub, "no resetTime", schedule.type);
      continue;
    }
    const parsed = new Date(bucket.resetTime);
    if (Number.isNaN(parsed.getTime())) {
      skipInfo(sub, "invalid timestamp", schedule.type);
      continue;
    }
    if (parsed.getTime() <= now.getTime()) {
      skipInfo(sub, "resetTime <= now", schedule.type);
      continue;
    }

    const candidate: CalibrationCandidate = {
      subId: sub.id,
      scheduleId: schedule.id,
      newResetTime: bucket.resetTime,
    };
    if (schedule.type === "weekly") {
      candidate.dayOfWeek = extractDayOfWeekFromDate(parsed, schedule.timezone);
      candidate.timeOfDay = extractTimeOfDayFromDate(parsed, schedule.timezone);
    } else if (schedule.type === "monthly") {
      candidate.dayOfMonth = extractDayOfMonthFromDate(
        parsed,
        schedule.timezone
      );
      candidate.timeOfDay = extractTimeOfDayFromDate(parsed, schedule.timezone);
    }
    candidates.push(candidate);
  }

  return candidates;
}

function applyCandidates(candidates: CalibrationCandidate[]): void {
  const data = readData();
  // Take the timestamp at write time (not at fetch time) so slow API responses
  // don't produce stale updatedAt values — matches toggleScheduleExhausted.
  const nowIso = new Date().toISOString();
  let anyWritten = false;

  for (const candidate of candidates) {
    const sub = data.subscriptions.find((s) => s.id === candidate.subId);
    if (!sub) {
      console.info(
        `[Scheduler] Reset-time calibration skipped for (${candidate.subId}): subscription deleted`
      );
      continue;
    }
    const schedule: ResetSchedule | undefined = sub.resetSchedules?.find(
      (s) => s.id === candidate.scheduleId
    );
    if (!schedule) {
      console.info(
        `[Scheduler] Reset-time calibration skipped for ${sub.name}(${sub.id}) ${candidate.scheduleId}: schedule deleted`
      );
      continue;
    }
    if (!schedule.enabled) {
      skipInfo(sub, "schedule disabled", schedule.type);
      continue;
    }

    const unchanged =
      schedule.nextResetTime === candidate.newResetTime &&
      schedule.timeOfDay === candidate.timeOfDay &&
      schedule.dayOfWeek === candidate.dayOfWeek &&
      schedule.dayOfMonth === candidate.dayOfMonth;
    if (unchanged) {
      // Already calibrated — log but do not touch disk.
      console.info(
        `[Scheduler] Reset-time calibrated for ${sub.name}(${sub.id}) ${schedule.type}: ${schedule.nextResetTime} → ${candidate.newResetTime}`
      );
      continue;
    }

    const oldResetTime = schedule.nextResetTime;
    schedule.nextResetTime = candidate.newResetTime;
    if (candidate.timeOfDay !== undefined) {
      schedule.timeOfDay = candidate.timeOfDay;
    }
    if (candidate.dayOfWeek !== undefined) {
      schedule.dayOfWeek = candidate.dayOfWeek;
    }
    if (candidate.dayOfMonth !== undefined) {
      schedule.dayOfMonth = candidate.dayOfMonth;
    }
    schedule.updatedAt = nowIso;
    sub.updatedAt = nowIso;
    anyWritten = true;
    console.info(
      `[Scheduler] Reset-time calibrated for ${sub.name}(${sub.id}) ${schedule.type}: ${oldResetTime} → ${candidate.newResetTime}`
    );
  }

  if (anyWritten) {
    writeData(data);
  }
}

/**
 * Calibrate one subscription's schedules from an already-fetched UsageResult
 * and persist. Used by the usage query route: the caller already paid for the
 * fetch, so no second request is made here. Returns the freshest copy of the
 * subscription (whether or not anything changed), or null if it is gone.
 */
export function calibrateSubscriptionFromUsage(
  subId: string,
  result: UsageResult
): Subscription | null {
  const data = readData();
  const sub = data.subscriptions.find((s) => s.id === subId);
  if (!sub) {
    console.info(
      `[Scheduler] Reset-time calibration skipped for (${subId}): subscription not found`
    );
    return null;
  }

  const candidates = computeCandidates(sub, result, new Date());
  if (candidates.length > 0) {
    applyCandidates(candidates);
  }

  return readData().subscriptions.find((s) => s.id === subId) ?? null;
}

/**
 * Scheduler entry point. Called from the scheduler cron callback AFTER
 * `processResetTick()` and `runNotificationTick()`. Zero changes to those.
 *
 * Flow:
 * 1. Dedupe triggers by subscriptionId (one fetchUsage per sub).
 * 2. For each subscription: check preconditions, fetch usage, compute
 *    per-schedule candidates.
 * 3. After all fetches, do ONE read-modify-write pass. Re-locate each
 *    candidate by subId+scheduleId in freshly-read data; skip + log if the
 *    subscription or schedule was deleted or the schedule was disabled in
 *    the meantime.
 *
 * Notifications never wait for / depend on calibration.
 */
export async function alignResetTimes(
  triggers: ResetTickTrigger[]
): Promise<void> {
  if (triggers.length === 0) return;

  // Dedupe by subscriptionId: same sub → one fetch covers all its schedules.
  const subIds = new Set<string>();
  for (const trigger of triggers) {
    subIds.add(trigger.subscriptionId);
  }

  const candidates: CalibrationCandidate[] = [];
  const now = new Date();

  for (const subId of Array.from(subIds)) {
    const subCandidates = await computeCandidatesForSub(subId, now);
    candidates.push(...subCandidates);
  }

  if (candidates.length === 0) return;

  // Single read-modify-write pass.
  applyCandidates(candidates);
}

async function computeCandidatesForSub(
  subId: string,
  now: Date
): Promise<CalibrationCandidate[]> {
  // Read fresh data to check preconditions and enumerate enabled schedules.
  const data = readData();
  const sub = data.subscriptions.find((s) => s.id === subId);
  if (!sub) {
    console.info(
      `[Scheduler] Reset-time calibration skipped for (${subId}): subscription not found`
    );
    return [];
  }

  if (!sub.credentials) {
    skipInfo(sub, "no credentials");
    return [];
  }

  const resolved = resolveUsageHandler(sub);
  if (!resolved.ok) {
    const reasonMap: Record<typeof resolved.reason, string> = {
      "not-recurring": "not recurring",
      "no-usage-api-url": "no usage API URL",
      "no-handler": "no handler",
    };
    skipInfo(sub, reasonMap[resolved.reason]);
    return [];
  }

  let credentials: Record<string, string>;
  try {
    credentials = decryptCredentials(sub.credentials);
  } catch {
    skipInfo(sub, "fetch failed");
    return [];
  }

  let result: UsageResult;
  try {
    result = await resolved.handler.fetchUsage(credentials);
  } catch {
    skipInfo(sub, "fetch failed");
    return [];
  }

  return computeCandidates(sub, result, now);
}
