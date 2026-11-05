// Port of lib/status-policy.ts: the single policy deriving a subscription's
// visible status from its persisted status and reset schedules.

import type {
  ResetSchedule,
  Subscription,
  SubscriptionStatus,
} from "./types";

export interface ResolvedStatus {
  status: SubscriptionStatus;
  reason:
    | { kind: "manual-cancelled" }
    | { kind: "schedule-exhausted"; scheduleIds: string[] }
    | { kind: "manual-paused" }
    | { kind: "available" };
}

function enabled(schedules: ResetSchedule[] | undefined): ResetSchedule[] {
  return (schedules ?? []).filter((schedule) => schedule.enabled);
}

export function resolveStatus(subscription: Subscription): ResolvedStatus {
  const exhausted = enabled(subscription.resetSchedules).filter(
    (schedule) => schedule.exhausted === true
  );

  if (subscription.status === "cancelled") {
    return { status: "cancelled", reason: { kind: "manual-cancelled" } };
  }

  if (exhausted.length > 0) {
    return {
      status: "paused",
      reason: {
        kind: "schedule-exhausted",
        scheduleIds: exhausted.map((schedule) => schedule.id),
      },
    };
  }

  return {
    status: "active",
    reason:
      subscription.status === "paused"
        ? { kind: "manual-paused" }
        : { kind: "available" },
  };
}
