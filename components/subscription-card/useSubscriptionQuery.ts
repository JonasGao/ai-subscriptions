import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Subscription,
  BalanceResult,
  UsageResult,
  UsageWindow,
} from "@/lib/types";
import { getProviderCurrency } from "@/lib/utils";

/**
 * Quota/balance query flow for a single subscription card: mount auto-query,
 * 60s cooldown with confirmation, and usage-driven auto-exhaust linking.
 *
 * Cooldown semantics: only a successful query (usage or balance) sets
 * lastQueryAt; failures neither start nor restart the window. Within the
 * window the button stays clickable but asks for confirmation first;
 * confirming re-runs the query and restarts the window.
 */
export function useSubscriptionQuery({
  subscription,
  canQuery,
  onEdit,
  onScheduleToggle,
  onBalanceUpdate,
}: {
  subscription: Subscription;
  canQuery: boolean;
  onEdit: (subscription: Subscription) => void;
  onScheduleToggle?: (
    subscriptionId: string,
    scheduleId: string,
    exhausted: boolean
  ) => Promise<void> | void;
  onBalanceUpdate?: (id: string, balance: number, currency: string) => void;
}) {
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [previousBalance, setPreviousBalance] = useState<{
    amount: number;
    currency: string;
  } | null>(null);
  const [lastQueryAt, setLastQueryAt] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const inCooldown = lastQueryAt !== null && Date.now() - lastQueryAt < 60_000;

  const runQuery = async () => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      if (subscription.subscriptionType === "recurring") {
        const res = await fetch(`/api/subscriptions/${subscription.id}/usage`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const err = await res.json();
          setBalanceError(err.error || "查询失败");
          return;
        }
        const data: UsageResult = await res.json();
        setUsage(data);
        setLastQueryAt(Date.now());

        // Surface server-side parse warnings (e.g. skipped quota rows) as a toast
        if (data.warnings && data.warnings.length > 0) {
          toast.warning(data.warnings.join("\n"));
        }

        // Auto-exhaust: mark schedules as exhausted when usage reaches 100%.
        // Toggles are awaited sequentially so concurrent read-modify-write on
        // subscriptions.json cannot lose updates (each POST sees the previous
        // write's result before the next starts).
        const windows: Array<{
          type: "fiveHour" | "weekly" | "monthly";
          usageWindow: UsageWindow | null;
        }> = [
          { type: "fiveHour", usageWindow: data.fiveHour },
          { type: "weekly", usageWindow: data.weekly },
          { type: "monthly", usageWindow: data.monthly },
        ];

        for (const { type, usageWindow } of windows) {
          if (!usageWindow) continue;
          const limit = Number(usageWindow.limit);
          const used = Number(usageWindow.used);
          if (!Number.isFinite(limit) || limit <= 0) continue;
          if (!Number.isFinite(used) || used < limit) continue;

          // Find matching schedule
          const schedule = subscription.resetSchedules?.find(
            (s) => s.type === type && s.enabled && !s.exhausted
          );
          if (schedule) {
            await toggleSchedule(schedule.id, true);
          }
        }

        return;
      }
      const res = await fetch(`/api/subscriptions/${subscription.id}/balance`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json();
        setBalanceError(err.error || "查询失败");
        return;
      }
      const data: BalanceResult = await res.json();
      // Capture previous balance before overwriting
      const first = data.balanceInfos[0];
      if (first) {
        const prevCurrency =
          subscription.balanceCurrency ??
          getProviderCurrency(subscription.provider);
        const prevAmount = balance?.balanceInfos[0]
          ? parseFloat(balance.balanceInfos[0].available)
          : (subscription.balance ?? NaN);
        if (Number.isFinite(prevAmount)) {
          setPreviousBalance({ amount: prevAmount, currency: prevCurrency });
        }
        if (onBalanceUpdate) {
          const newAmount = parseFloat(first.available);
          if (Number.isFinite(newAmount)) {
            onBalanceUpdate(subscription.id, newAmount, first.currency);
          }
        }
      }
      setBalance(data);
      setLastQueryAt(Date.now());
    } catch {
      setBalanceError("网络请求失败");
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleQueryClick = () => {
    // If credentials are not configured, open the edit dialog
    if (!subscription.hasCredentials) {
      onEdit(subscription);
      return;
    }
    if (balanceLoading) return;
    if (inCooldown) {
      setConfirmOpen(true);
      return;
    }
    runQuery();
  };

  const handleConfirmQuery = () => {
    setConfirmOpen(false);
    runQuery();
  };

  const toggleSchedule = (
    scheduleId: string,
    exhausted: boolean
  ): Promise<void> | void => {
    if (onScheduleToggle) {
      return onScheduleToggle(subscription.id, scheduleId, exhausted);
    }
  };

  // Auto-trigger a single usage/balance query on mount for eligible active
  // subscriptions. Calls runQuery directly (not handleQueryClick) so it never
  // opens the confirm dialog or the edit dialog.
  useEffect(() => {
    if (subscription.status !== "active") return;
    if (!subscription.hasCredentials) return;
    if (!canQuery) return;
    runQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    balance,
    usage,
    balanceLoading,
    balanceError,
    previousBalance,
    inCooldown,
    confirmOpen,
    setConfirmOpen,
    handleQueryClick,
    handleConfirmQuery,
    toggleSchedule,
  };
}
