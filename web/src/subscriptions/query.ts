// Port of components/subscription-card/useSubscriptionQuery.ts: the quota query
// flow for one subscription card.
//
// Owned by #28: mount auto-query, the usage/balance dispatch, the 60s Query
// Cooldown with a confirmation step, and the balance-result bookkeeping.
// Deliberately NOT here yet: auto-exhaust linkage (#29), reset-time calibration
// echo handling and its form update (#34) — those tickets extend this flow.

import { createEffect, createSignal } from "solid-js";
import type {
  BalanceResult,
  Subscription,
  SubscriptionStatus,
  UsageQueryResponse,
} from "../subscriptions/types";

export interface SubscriptionQueryOptions {
  subscription: Subscription;
  /** Reactive: the provider catalog may arrive after the card mounts. */
  canQuery: () => boolean;
  onEdit: (subscription: Subscription) => void;
  onBalanceUpdate?: (id: string, balance: number, currency: string) => void;
  onSubscriptionUpdate?: (subscription: Subscription) => void;
}

export interface PreviousBalance {
  amount: number;
  currency: string;
}

const COOLDOWN_MS = 60_000;

/**
 * createSubscriptionQuery wires the card's quota button. Cooldown semantics:
 * only a successful query starts the window; failures neither start nor
 * restart it. Within the window the button stays clickable but asks for
 * confirmation first; confirming re-runs the query and restarts the window.
 */
export function createSubscriptionQuery(options: SubscriptionQueryOptions) {
  const [balance, setBalance] = createSignal<BalanceResult | null>(null);
  const [usage, setUsage] = createSignal<UsageQueryResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [previousBalance, setPreviousBalance] =
    createSignal<PreviousBalance | null>(null);
  const [lastQueryAt, setLastQueryAt] = createSignal<number | null>(null);
  const [confirmOpen, setConfirmOpen] = createSignal(false);

  const inCooldown = () => {
    const at = lastQueryAt();
    return at !== null && Date.now() - at < COOLDOWN_MS;
  };

  const isRecurring = () => options.subscription.subscriptionType === "recurring";

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isRecurring()) {
        const res = await fetch(
          `/api/subscriptions/${options.subscription.id}/usage`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          setError(err.error || "查询失败");
          return;
        }
        const data = (await res.json()) as UsageQueryResponse;
        setUsage(data);
        setLastQueryAt(Date.now());
        // The usage route echoes the (currently uncalibrated) subscription;
        // #34 fills in reset-time calibration. Pushing it up keeps the list in
        // sync without a refetch.
        if (data.subscription) options.onSubscriptionUpdate?.(data.subscription);
        return;
      }

      const res = await fetch(
        `/api/subscriptions/${options.subscription.id}/balance`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setError(err.error || "查询失败");
        return;
      }
      const data = (await res.json()) as BalanceResult;
      const first = data.balanceInfos[0];
      if (first) {
        const previousAmount = balance()?.balanceInfos[0]
          ? parseFloat(balance()!.balanceInfos[0].available)
          : (options.subscription.balance ?? NaN);
        if (Number.isFinite(previousAmount)) {
          setPreviousBalance({
            amount: previousAmount,
            currency:
              options.subscription.balanceCurrency ??
              data.balanceInfos[0].currency,
          });
        }
        const newAmount = parseFloat(first.available);
        if (Number.isFinite(newAmount)) {
          options.onBalanceUpdate?.(options.subscription.id, newAmount, first.currency);
        }
      }
      setBalance(data);
      setLastQueryAt(Date.now());
    } catch {
      setError("网络请求失败");
    } finally {
      setLoading(false);
    }
  };

  const handleQueryClick = () => {
    // No credentials → route the user to the edit dialog instead of querying.
    if (!options.subscription.hasCredentials) {
      options.onEdit(options.subscription);
      return;
    }
    if (loading()) return;
    if (inCooldown()) {
      setConfirmOpen(true);
      return;
    }
    void runQuery();
  };

  const handleConfirmQuery = () => {
    setConfirmOpen(false);
    void runQuery();
  };

  // One auto-query for eligible active subscriptions, fired as soon as the
  // provider catalog is available (the card may mount before it). Runs at most
  // once; calls runQuery directly so it never opens the confirm/edit dialog.
  let autoQueryStarted = false;
  createEffect(() => {
    if (autoQueryStarted) return;
    if (options.subscription.status !== "active") return;
    if (!options.subscription.hasCredentials) return;
    if (!options.canQuery()) return;
    autoQueryStarted = true;
    void runQuery();
  });

  return {
    balance,
    usage,
    loading,
    error,
    previousBalance,
    inCooldown,
    confirmOpen,
    setConfirmOpen,
    handleQueryClick,
    handleConfirmQuery,
    /** Exposed for tests/status display: the persisted status the mount gate reads. */
    status: () => options.subscription.status as SubscriptionStatus,
  };
}
