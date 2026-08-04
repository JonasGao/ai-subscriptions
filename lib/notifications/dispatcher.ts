import {
  Subscription,
  NotificationChannel,
  DEFAULT_LOW_BALANCE_THRESHOLD,
} from "@/lib/types";
import { NotificationEvent, PreparedSend, prepareSend } from "./payload";
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
 * Determines whether the balance has just transitioned from above to below
 * the threshold for a subscription.
 *
 * Returns null when no transition should fire:
 * - balance still above threshold
 * - already below and previously notified
 *
 * Returns "fire" when the balance just crossed below; the caller is
 * responsible for persisting the new transition state.
 */
export function evaluateLowBalanceTransition(
  subscriptionId: string,
  balance: number,
  threshold: number,
  now: Date = new Date()
): { shouldFire: boolean; newStatus: "above" | "below" } {
  const currentStatus: "above" | "below" =
    balance >= threshold ? "above" : "below";
  const prev = getBalanceTransitionState(subscriptionId);

  if (!prev) {
    // First observation: only fire if immediately below, so we don't spam
    // every existing low-balance subscription on first run.
    return { shouldFire: currentStatus === "below", newStatus: currentStatus };
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
 * Returns events + updates transition state.
 */
export function detectLowBalanceEvents(
  subscriptions: Subscription[],
  now: Date = new Date()
): NotificationEvent[] {
  const data = readNotificationData();
  const events: NotificationEvent[] = [];

  for (const sub of subscriptions) {
    if (sub.subscriptionType !== "one-time") continue;
    if (sub.status === "cancelled") continue;
    if (typeof sub.balance !== "number") continue;

    const threshold = resolveThreshold(sub, data.defaultLowBalanceThreshold);
    const { shouldFire, newStatus } = evaluateLowBalanceTransition(
      sub.id,
      sub.balance,
      threshold,
      now
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
 */
export async function dispatchEvent(
  event: NotificationEvent,
  channels: NotificationChannel[],
  sender: Sender
): Promise<void> {
  const enabled = channels.filter((c) => c.enabled);
  for (const channel of enabled) {
    try {
      const prepared = prepareSend(channel, event);
      await sender(prepared);
      updateChannelSendResult(channel.id, {
        success: true,
        timestamp: new Date().toISOString(),
      });
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
}

/**
 * Top-level tick entry point: detects low-balance events for one-time
 * subscriptions and dispatches them to all enabled channels.
 *
 * Mounted on the existing 5-minute scheduler after processResetTick.
 */
export async function runNotificationTick(
  subscriptions: Subscription[],
  sender: Sender = defaultSender
): Promise<void> {
  const channels = listChannels();
  if (channels.length === 0) return;

  const events = detectLowBalanceEvents(subscriptions);
  for (const event of events) {
    await dispatchEvent(event, channels, sender);
  }
}

async function defaultSender(send: PreparedSend): Promise<void> {
  const response = await fetch(send.url, {
    method: "POST",
    headers: send.headers,
    body: typeof send.body === "string" ? send.body : JSON.stringify(send.body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`
    );
  }
}
