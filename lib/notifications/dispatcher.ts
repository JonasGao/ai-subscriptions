import {
  Subscription,
  NotificationChannel,
  DEFAULT_LOW_BALANCE_THRESHOLD,
  ResetTickTrigger,
} from "@/lib/types";
import {
  NotificationEvent,
  PreparedSend,
  prepareSend,
  httpSender,
} from "./payload";
import { sendFeishuAppMessage } from "./feishu-app";
import {
  readNotificationData,
  getBalanceTransitionState,
  setBalanceTransitionState,
  listChannels,
  updateChannelSendResult,
} from "./storage";

/**
 * Injectable sender seam. The real implementation performs HTTP POST; tests
 * substitute a fake that records calls.
 */
export type Sender = (send: PreparedSend) => Promise<void>;

/**
 * Feishu-app sender: routes to sendFeishuAppMessage. This is separate from
 * the HTTP sender because feishu-app needs token management + retry logic.
 */
export type FeishuAppSender = (
  event: NotificationEvent,
  channel: NotificationChannel
) => Promise<void>;

/**
 * Default feishu-app sender used in production. Delegates to the feishu-app
 * module's sendFeishuAppMessage.
 */
export const defaultFeishuAppSender: FeishuAppSender = (event, channel) => {
  if (
    !channel.appId ||
    !channel.appSecret ||
    !channel.receiveId ||
    !channel.receiveIdType
  ) {
    throw new Error(
      `feishu-app channel ${channel.id} is missing required fields (appId/appSecret/receiveId/receiveIdType)`
    );
  }
  return sendFeishuAppMessage(event, {
    appId: channel.appId,
    appSecret: channel.appSecret,
    receiveId: channel.receiveId,
    receiveIdType: channel.receiveIdType,
  });
};

/**
 * Determines whether the balance has just transitioned from above to below
 * the threshold for a subscription.
 *
 * First observation: the subscription has no prior transition state. We only
 * record the current status without firing an event, so existing low-balance
 * subscriptions don't all trigger on first deployment.
 *
 * Subsequent observations: fires only when status flips from "above" to
 * "below". The caller is responsible for persisting the new transition state
 * (and rolling back if all dispatch attempts fail).
 */
export function evaluateLowBalanceTransition(
  subscriptionId: string,
  balance: number,
  threshold: number
): { shouldFire: boolean; newStatus: "above" | "below" } {
  const currentStatus: "above" | "below" =
    balance >= threshold ? "above" : "below";
  const prev = getBalanceTransitionState(subscriptionId);

  if (!prev) {
    // First observation: only record state, never fire. This avoids a
    // notification storm for every pre-existing low-balance subscription
    // when the notification system is first enabled.
    return { shouldFire: false, newStatus: currentStatus };
  }

  const transitionedFromAbove =
    prev.status === "above" && currentStatus === "below";
  return { shouldFire: transitionedFromAbove, newStatus: currentStatus };
}

/**
 * Resolves the effective threshold for a subscription:
 * subscription-level lowBalanceThreshold > global default.
 */
export function resolveThreshold(
  subscription: Subscription,
  globalDefault: number = DEFAULT_LOW_BALANCE_THRESHOLD
): number {
  return subscription.lowBalanceThreshold ?? globalDefault;
}

/**
 * Detects which subscriptions should fire low-balance events on this tick.
 * Updates transition state; caller must roll back if dispatch fails for all
 * channels (see dispatchEvent return value).
 */
export function detectLowBalanceEvents(
  subscriptions: Subscription[]
): NotificationEvent[] {
  const data = readNotificationData();
  const events: NotificationEvent[] = [];
  const now = new Date();

  for (const sub of subscriptions) {
    if (sub.subscriptionType !== "one-time") continue;
    if (sub.status === "cancelled") continue;
    if (typeof sub.balance !== "number") continue;

    const threshold = resolveThreshold(sub, data.defaultLowBalanceThreshold);
    const { shouldFire, newStatus } = evaluateLowBalanceTransition(
      sub.id,
      sub.balance,
      threshold
    );

    setBalanceTransitionState(sub.id, {
      status: newStatus,
      updatedAt: now.toISOString(),
    });

    if (shouldFire) {
      events.push({
        kind: "low-balance",
        subscription: sub,
        balance: sub.balance,
        threshold,
        triggeredAt: now.toISOString(),
      });
    }
  }
  return events;
}

/**
 * Dispatches an event to all enabled channels. Individual channel failures
 * are recorded in lastSendResult but never thrown upward.
 *
 * Returns the number of channels that succeeded. Caller uses this to decide
 * whether to persist the transition state (any success) or roll it back
 * (all failed).
 *
 * feishu-app channels are routed to `feishuAppSender` (which handles token
 * management + retry); other channel types go through the generic `sender`.
 */
export async function dispatchEvent(
  event: NotificationEvent,
  channels: NotificationChannel[],
  sender: Sender,
  feishuAppSender: FeishuAppSender = defaultFeishuAppSender
): Promise<number> {
  const enabled = channels.filter((c) => c.enabled);
  let successCount = 0;
  for (const channel of enabled) {
    try {
      if (channel.type === "feishu-app") {
        await feishuAppSender(event, channel);
      } else {
        const prepared = prepareSend(channel, event);
        await sender(prepared);
      }
      updateChannelSendResult(channel.id, {
        success: true,
        timestamp: new Date().toISOString(),
      });
      successCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[notifications] Failed to send to channel ${channel.name} (${channel.id}):`,
        message
      );
      updateChannelSendResult(channel.id, {
        success: false,
        timestamp: new Date().toISOString(),
        error: message,
      });
    }
  }
  return successCount;
}

/**
 * Rolls back a subscription's transition state to "above" so that the next
 * tick can re-evaluate it. Used when every enabled channel failed to send.
 */
export function rollbackTransition(subscriptionId: string): void {
  setBalanceTransitionState(subscriptionId, {
    status: "above",
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Builds one NotificationEvent per reset tick trigger. Triggers already come
 * pre-filtered by processResetTick (cancelled subscriptions and disabled
 * schedules never appear), so this function just needs to resolve the
 * subscription record and stamp the event.
 *
 * A trigger whose subscription no longer exists (deleted between the reset
 * tick and the notification tick) is silently skipped.
 */
export function detectResetEvents(
  triggers: ResetTickTrigger[],
  subscriptions: Subscription[]
): NotificationEvent[] {
  const byId = new Map(subscriptions.map((s) => [s.id, s]));
  const nowIso = new Date().toISOString();
  const events: NotificationEvent[] = [];
  for (const t of triggers) {
    const sub = byId.get(t.subscriptionId);
    if (!sub) continue;
    events.push({
      kind: "reset",
      subscription: sub,
      scheduleType: t.scheduleType,
      nextResetTime: t.nextResetTime,
      triggeredAt: nowIso,
    });
  }
  return events;
}

/**
 * Options for runNotificationTick.
 */
export interface NotificationTickOptions {
  subscriptions: Subscription[];
  resetTriggers?: ResetTickTrigger[];
  sender?: Sender;
}

/**
 * Top-level tick entry point: dispatches reset events first (fire-and-forget,
 * no deduplication or rollback), then detects and dispatches low-balance
 * events (with rollback on total channel failure).
 *
 * Mounted on the existing 5-minute scheduler after processResetTick.
 */
export async function runNotificationTick(
  options: NotificationTickOptions
): Promise<void> {
  const { subscriptions, resetTriggers = [], sender = httpSender } = options;
  const channels = listChannels();
  if (channels.length === 0) return;

  const resetEvents = detectResetEvents(resetTriggers, subscriptions);
  for (const event of resetEvents) {
    await dispatchEvent(event, channels, sender);
  }

  const lowBalanceEvents = detectLowBalanceEvents(subscriptions);
  for (const event of lowBalanceEvents) {
    const successCount = await dispatchEvent(event, channels, sender);
    if (successCount === 0) {
      // Every enabled channel failed — roll back so the next tick retries.
      rollbackTransition(event.subscription.id);
    }
  }
}
