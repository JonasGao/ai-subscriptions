import { readData, writeData } from "./db";
import { decryptCredentials } from "./encryption";
import { resolveUsageHandler } from "./providers";
import type {
  ResetTickTrigger,
  ResetScheduleType,
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

interface AlignmentCandidate {
  subId: string;
  scheduleId: string;
  newResetTime: string;
}

/** Skip-log helper: keeps every skip message byte-identical to the spec. */
function skipInfo(
  sub: { name: string; id: string },
  reason: string,
  schedulePart?: string
): void {
  const tail = schedulePart ? ` ${schedulePart}: ${reason}` : `: ${reason}`;
  console.info(
    `[Scheduler] Reset-time alignment skipped for ${sub.name}(${sub.id})${tail}`
  );
}

/**
 * Core alignment entry point. Called from the scheduler cron callback AFTER
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
 * Notifications never wait for / depend on alignment.
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

  const candidates: AlignmentCandidate[] = [];
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
): Promise<AlignmentCandidate[]> {
  const candidates: AlignmentCandidate[] = [];

  // Read fresh data to check preconditions and enumerate enabled schedules.
  const data = readData();
  const sub = data.subscriptions.find((s) => s.id === subId);
  if (!sub) {
    console.info(
      `[Scheduler] Reset-time alignment skipped for (${subId}): subscription not found`
    );
    return candidates;
  }

  if (!sub.credentials) {
    skipInfo(sub, "no credentials");
    return candidates;
  }

  const resolved = resolveUsageHandler(sub);
  if (!resolved.ok) {
    const reasonMap: Record<typeof resolved.reason, string> = {
      "not-recurring": "not recurring",
      "no-usage-api-url": "no usage API URL",
      "no-handler": "no handler",
    };
    skipInfo(sub, reasonMap[resolved.reason]);
    return candidates;
  }

  let credentials: Record<string, string>;
  try {
    credentials = decryptCredentials(sub.credentials);
  } catch {
    skipInfo(sub, "fetch failed");
    return candidates;
  }

  let result: UsageResult;
  try {
    result = await resolved.handler.fetchUsage(credentials);
  } catch {
    skipInfo(sub, "fetch failed");
    return candidates;
  }

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
    candidates.push({
      subId: sub.id,
      scheduleId: schedule.id,
      newResetTime: bucket.resetTime,
    });
  }

  return candidates;
}

function applyCandidates(candidates: AlignmentCandidate[]): void {
  const data = readData();
  // Take the timestamp at write time (not at fetch time) so slow API responses
  // don't produce stale updatedAt values — matches toggleScheduleExhausted.
  const nowIso = new Date().toISOString();
  let anyWritten = false;

  for (const candidate of candidates) {
    const sub = data.subscriptions.find((s) => s.id === candidate.subId);
    if (!sub) {
      console.info(
        `[Scheduler] Reset-time alignment skipped for (${candidate.subId}): subscription deleted`
      );
      continue;
    }
    const schedule: ResetSchedule | undefined = sub.resetSchedules?.find(
      (s) => s.id === candidate.scheduleId
    );
    if (!schedule) {
      console.info(
        `[Scheduler] Reset-time alignment skipped for ${sub.name}(${sub.id}) ${candidate.scheduleId}: schedule deleted`
      );
      continue;
    }
    if (!schedule.enabled) {
      skipInfo(sub, "schedule disabled", schedule.type);
      continue;
    }

    if (schedule.nextResetTime === candidate.newResetTime) {
      // Already aligned — log but do not touch disk.
      console.info(
        `[Scheduler] Reset-time aligned for ${sub.name}(${sub.id}) ${schedule.type}: ${schedule.nextResetTime} → ${candidate.newResetTime}`
      );
      continue;
    }

    const oldResetTime = schedule.nextResetTime;
    schedule.nextResetTime = candidate.newResetTime;
    schedule.updatedAt = nowIso;
    sub.updatedAt = nowIso;
    anyWritten = true;
    console.info(
      `[Scheduler] Reset-time aligned for ${sub.name}(${sub.id}) ${schedule.type}: ${oldResetTime} → ${candidate.newResetTime}`
    );
  }

  if (anyWritten) {
    writeData(data);
  }
}
