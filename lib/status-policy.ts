import {
  EffectiveStatusReason,
  Subscription,
  SubscriptionStatus,
} from "./types";

export interface ResolvedStatus {
  status: SubscriptionStatus;
  reason: EffectiveStatusReason;
}

/** Resolve persisted status and reset schedules through one policy. */
export function resolveStatus(subscription: Subscription): ResolvedStatus {
  const enabledSchedules =
    subscription.resetSchedules?.filter((schedule) => schedule.enabled) ?? [];
  const exhaustedSchedules = enabledSchedules.filter(
    (schedule) => schedule.exhausted === true
  );

  if (subscription.status === "cancelled") {
    return { status: "cancelled", reason: { kind: "manual-cancelled" } };
  }

  if (exhaustedSchedules.length > 0) {
    return {
      status: "paused",
      reason: {
        kind: "schedule-exhausted",
        scheduleIds: exhaustedSchedules.map((schedule) => schedule.id),
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

export function deriveStatus(subscription: Subscription): SubscriptionStatus {
  return resolveStatus(subscription).status;
}

export function explainStatus(
  subscription: Subscription
): EffectiveStatusReason {
  return resolveStatus(subscription).reason;
}
