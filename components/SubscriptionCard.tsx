"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Subscription,
  defaultProviders,
  BalanceResult,
  UsageResult,
  UsageWindow,
} from "@/lib/types";
import { useNow } from "@/hooks/useNow";
import {
  formatDate,
  isExpiringSoon,
  getDaysUntilRenewal,
  formatNextResetTime,
  getScheduleTypeLabel,
  getStatusReason,
  formatResetTimeTooltip,
  getUsagePercent,
  getProgressTier,
  formatBalance,
  getProviderCurrency,
  type ProgressTier,
} from "@/lib/utils";
import { sortResetSchedules } from "@/lib/reset-schedule";
import {
  Edit,
  Trash2,
  Wallet,
  Loader2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Fragment } from "react";

interface SubscriptionCardProps {
  subscription: Subscription;
  onEdit: (subscription: Subscription) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, newStatus: "active" | "paused") => void;
  onScheduleToggle?: (
    subscriptionId: string,
    scheduleId: string,
    exhausted: boolean
  ) => Promise<void> | void;
  onBalanceUpdate?: (id: string, balance: number, currency: string) => void;
}

function getStatusBadgeVariant(
  status: Subscription["status"]
): "success" | "warning" | "outline" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "cancelled":
      return "outline";
    default:
      return "outline";
  }
}

function getStatusLabel(status: Subscription["status"]): string {
  switch (status) {
    case "active":
      return "活跃";
    case "paused":
      return "暂停";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function getProviderName(provider: string, providerCustom?: string): string {
  if (provider === "other" && providerCustom) {
    return providerCustom;
  }
  const found = defaultProviders.find((p) => p.id === provider);
  return found?.name || provider;
}

function getPlanName(provider: string, planId?: string): string | null {
  if (!planId) return null;
  const found = defaultProviders.find((p) => p.id === provider);
  const plan = found?.plans?.find((p) => p.id === planId);
  return plan?.name ?? null;
}

function getPlanUsageApiUrl(
  provider: (typeof defaultProviders)[number] | undefined,
  planId?: string
): string | undefined {
  if (!provider) return undefined;
  if (planId && provider.plans) {
    const plan = provider.plans.find((p) => p.id === planId);
    if (plan?.usageApiUrl) return plan.usageApiUrl;
  }
  return provider.usageApiUrl;
}

function getTypeLabel(type: string): string {
  return type === "recurring" ? "周期性" : "一次性";
}

function formatUsageAmount(value: string): string {
  if (value.trim() === "") return value;
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : value;
}

function getUsageUnitLabel(unit: string): string {
  return unit === "UNIT_CURRENCY" ? "单位" : unit;
}

function formatPriceFromCents(priceInCents: string): string {
  const num = parseInt(priceInCents, 10);
  return Number.isNaN(num) ? priceInCents : `¥${(num / 100).toFixed(2)}`;
}

function formatMembershipLevel(level: string): string {
  const clean = level.startsWith("LEVEL_")
    ? level.slice("LEVEL_".length)
    : level;
  switch (clean) {
    case "BASIC":
      return "基础版";
    case "PLUS":
      return "增强版";
    case "PRO":
      return "专业版";
    case "MAX":
      return "旗舰版";
    default:
      return clean;
  }
}

function UsageAmountText({ window }: { window: UsageWindow }) {
  return (
    <span className="text-xs font-medium">
      已用{" "}
      <span className="tabular-nums">{formatUsageAmount(window.used)}</span> ·
      剩余{" "}
      <span className="tabular-nums text-green-600">
        {formatUsageAmount(window.remaining)}
      </span>
    </span>
  );
}

const PROGRESS_BAR_COLORS: Record<ProgressTier, string> = {
  normal: "bg-primary",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

function UsageProgressBar({ window }: { window: UsageWindow }) {
  const percent = getUsagePercent(window.used, window.limit);
  const tier = percent === null ? null : getProgressTier(percent);
  const width = percent === null ? 0 : Math.round(percent);
  return (
    <div className="mt-1 space-y-1">
      {tier !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${PROGRESS_BAR_COLORS[tier]}`}
            style={{ width: `${width}%` }}
          />
        </div>
      )}
      <div className="flex items-center gap-1">
        <Clock className="h-3 w-3 text-muted-foreground" />
        {window.resetTime ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-xs text-muted-foreground">
                {formatNextResetTime(window.resetTime)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {formatResetTimeTooltip(window.resetTime)}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function UsageBlock({ label, window }: { label: string; window: UsageWindow }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <UsageAmountText window={window} />
      </div>
      <UsageProgressBar window={window} />
    </div>
  );
}

export function SubscriptionCard({
  subscription,
  onEdit,
  onDelete,
  onStatusChange,
  onScheduleToggle,
  onBalanceUpdate,
}: SubscriptionCardProps) {
  // Re-render periodically so formatNextResetTime (which uses new Date()) updates
  useNow();
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
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<0 | 1 | 2>(0);
  const isRecurring = subscription.subscriptionType === "recurring";
  const expiringSoon =
    isRecurring && subscription.renewalDate
      ? isExpiringSoon(subscription.renewalDate)
      : false;
  const daysUntilRenewal =
    isRecurring && subscription.renewalDate
      ? getDaysUntilRenewal(subscription.renewalDate)
      : null;
  const providerName = getProviderName(
    subscription.provider,
    subscription.providerCustom
  );
  const planName = getPlanName(subscription.provider, subscription.planId);
  const typeLabel = getTypeLabel(subscription.subscriptionType);
  const priceLabel =
    subscription.subscriptionType === "one-time"
      ? `¥${subscription.price.toFixed(2)}`
      : subscription.billingCycle === "yearly"
        ? `¥${subscription.price.toFixed(2)}/年`
        : `¥${subscription.price.toFixed(2)}/月`;
  const providerConfig = defaultProviders.find(
    (p) => p.id === subscription.provider
  );
  const canQuery =
    subscription.subscriptionType === "one-time"
      ? !!providerConfig?.balanceApiUrl
      : !!getPlanUsageApiUrl(providerConfig, subscription.planId);
  const isOneTime = subscription.subscriptionType === "one-time";
  const canToggleStatus =
    subscription.status === "active" || subscription.status === "paused";
  const statusReason = getStatusReason(subscription);

  // Query cooldown: 60s after the last successful query (including the
  // mount auto-query). Within the window the button stays clickable but
  // asks for confirmation first; confirming re-runs the query and restarts
  // the window. Failed queries neither start nor restart the cooldown.
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
            await handleScheduleToggle(schedule.id, true);
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

  const handleStatusToggle = () => {
    if (!canToggleStatus) return;
    const newStatus = subscription.status === "active" ? "paused" : "active";
    onStatusChange(subscription.id, newStatus);
  };

  const handleScheduleToggle = (
    scheduleId: string,
    exhausted: boolean
  ): Promise<void> | void => {
    if (onScheduleToggle) {
      return onScheduleToggle(subscription.id, scheduleId, exhausted);
    }
  };

  const getStatusDisplay = () => {
    if (statusReason.kind === "manual-cancelled") {
      return { label: "已取消", color: "text-gray-500" };
    }
    if (statusReason.kind === "schedule-exhausted") {
      return { label: "已用尽", color: "text-red-500" };
    }
    if (statusReason.kind === "manual-paused") {
      return { label: "手动暂停", color: "text-yellow-500" };
    }
    return { label: "可用", color: "text-green-500" };
  };

  return (
    <TooltipProvider>
      <Card
        className={`flex flex-col w-full ${expiringSoon ? "border-orange-500 border-2" : ""}`}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-medium">
            {subscription.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            {statusReason.kind === "schedule-exhausted" &&
              statusReason.scheduleIds.length > 0 && (
                <span className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  额度用尽
                </span>
              )}
            <Badge
              variant={getStatusBadgeVariant(subscription.status)}
              className={
                canToggleStatus
                  ? "cursor-pointer hover:opacity-80 transition-opacity"
                  : ""
              }
              onClick={handleStatusToggle}
            >
              {getStatusLabel(subscription.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col flex-1">
          <div className="space-y-2 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">提供商</span>
              <span className="text-sm font-medium">{providerName}</span>
            </div>
            {planName && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">方案</span>
                <span className="text-sm font-medium">{planName}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">分类</span>
              <span className="text-sm font-medium">
                {subscription.category}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">类型</span>
              <Badge variant="outline" className="text-xs">
                {typeLabel}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {isRecurring ? "价格" : "充值金额"}
              </span>
              <span className="text-sm font-medium">{priceLabel}</span>
            </div>
            {isOneTime && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">余额</span>
                <span className="text-sm font-medium text-green-600">
                  {(() => {
                    const currency =
                      balance?.balanceInfos[0]?.currency ??
                      subscription.balanceCurrency ??
                      getProviderCurrency(subscription.provider);
                    if (balance && balance.balanceInfos[0]) {
                      const newAmount = balance.balanceInfos[0].available;
                      const oldAmountStr = previousBalance
                        ? formatBalance(
                            previousBalance.amount,
                            previousBalance.currency
                          )
                        : subscription.balance != null
                          ? formatBalance(subscription.balance, currency)
                          : null;
                      const newNum = parseFloat(newAmount);
                      const oldNum = previousBalance
                        ? previousBalance.amount
                        : (subscription.balance ?? NaN);
                      const showParen =
                        oldAmountStr &&
                        Number.isFinite(oldNum) &&
                        Number.isFinite(newNum) &&
                        newNum !== oldNum;
                      return (
                        <>
                          <span>{formatBalance(newAmount, currency)}</span>
                          {showParen && (
                            <span className="ml-1 text-gray-500 font-normal">
                              ({oldAmountStr})
                            </span>
                          )}
                        </>
                      );
                    }
                    return subscription.balance != null
                      ? formatBalance(subscription.balance, currency)
                      : "-";
                  })()}
                </span>
              </div>
            )}
            {isRecurring && subscription.renewalDate && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">续费日期</span>
                <span
                  className={`text-sm font-medium ${expiringSoon ? "text-orange-500" : ""}`}
                >
                  {formatDate(subscription.renewalDate)}
                  {expiringSoon && daysUntilRenewal !== null && (
                    <span className="ml-1">({daysUntilRenewal}天后)</span>
                  )}
                </span>
              </div>
            )}
            {canQuery &&
              balance &&
              balance.balanceInfos.map((info) => (
                <Fragment key={info.currency}>
                  {info.total !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        总额度
                      </span>
                      <span className="text-sm font-medium">
                        {formatBalance(info.total, info.currency)}
                      </span>
                    </div>
                  )}
                  {info.toppedUp !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        充值余额
                      </span>
                      <span className="text-sm font-medium">
                        {formatBalance(info.toppedUp, info.currency)}
                      </span>
                    </div>
                  )}
                  {info.granted !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        赠送额度
                      </span>
                      <span className="text-sm font-medium">
                        {formatBalance(info.granted, info.currency)}
                      </span>
                    </div>
                  )}
                  {info.used !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        已使用
                      </span>
                      <span className="text-sm font-medium">
                        {formatBalance(info.used, info.currency)}
                      </span>
                    </div>
                  )}
                  {info.frozen !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        冻结金额
                      </span>
                      <span className="text-sm font-medium">
                        {formatBalance(info.frozen, info.currency)}
                      </span>
                    </div>
                  )}
                  {info.extras?.map((extra) => (
                    <div
                      key={extra.label}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-muted-foreground">
                        {extra.label}
                      </span>
                      <span className="text-sm font-medium">{extra.value}</span>
                    </div>
                  ))}
                </Fragment>
              ))}
            {usage && (
              <div className="pt-2 space-y-2">
                {usage.fiveHour && (
                  <UsageBlock label="5小时" window={usage.fiveHour} />
                )}
                {usage.weekly && (
                  <UsageBlock label="周" window={usage.weekly} />
                )}
                {usage.monthly && (
                  <UsageBlock label="月" window={usage.monthly} />
                )}
                {usage.boosterWallet && (
                  <div>
                    <span className="text-sm text-muted-foreground">
                      加速包
                    </span>
                    <div className="mt-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          剩余额度
                        </span>
                        <span className="text-sm font-medium">
                          {usage.boosterWallet.balance
                            ? `${formatUsageAmount(usage.boosterWallet.balance.amountLeft)} ${getUsageUnitLabel(usage.boosterWallet.balance.unit)}`
                            : "-"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          本月已用
                        </span>
                        <span className="text-sm font-medium">
                          {usage.boosterWallet.monthlyUsed
                            ? formatPriceFromCents(
                                usage.boosterWallet.monthlyUsed.priceInCents
                              )
                            : "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {usage.parallel && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      并行上限
                    </span>
                    <span className="text-sm font-medium">
                      {usage.parallel.limit}
                    </span>
                  </div>
                )}
                {usage.membership && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      会员等级
                    </span>
                    <span className="text-sm font-medium">
                      {formatMembershipLevel(usage.membership.level)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {balanceError && (
              <div className="text-sm text-red-500">{balanceError}</div>
            )}
            {subscription.notes && (
              <div className="pt-2">
                <span className="text-sm text-muted-foreground">备注</span>
                <p className="text-sm mt-1">{subscription.notes}</p>
              </div>
            )}
            {subscription.resetSchedules &&
              subscription.resetSchedules.length > 0 && (
                <div className="pt-2">
                  <span className="text-sm text-muted-foreground">
                    额度重置计划
                  </span>
                  <div
                    className="mt-1 grid gap-y-1 text-xs"
                    style={{ gridTemplateColumns: "auto 3.5rem 1fr auto" }}
                  >
                    {sortResetSchedules(subscription.resetSchedules)
                      .filter((s) => s.enabled)
                      .map((schedule) => (
                        <div key={schedule.id} className="contents">
                          <Clock className="h-3 w-3 text-muted-foreground self-center" />
                          <span className="font-medium self-center">
                            {getScheduleTypeLabel(schedule.type)}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground self-center">
                                {formatNextResetTime(schedule.nextResetTime)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {formatResetTimeTooltip(
                                schedule.nextResetTime,
                                schedule.timezone
                              )}
                            </TooltipContent>
                          </Tooltip>
                          <Button
                            variant={
                              schedule.exhausted ? "destructive" : "outline"
                            }
                            size="sm"
                            className="h-5 px-2 text-xs"
                            onClick={() =>
                              handleScheduleToggle(
                                schedule.id,
                                !schedule.exhausted
                              )
                            }
                          >
                            {schedule.exhausted ? "已用尽" : "可用"}
                          </Button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
          </div>
          <div className="flex gap-2 pt-4 mt-auto">
            {canQuery && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleQueryClick}
                disabled={balanceLoading}
                title={
                  inCooldown && !balanceLoading
                    ? "60 秒内已查询过，再次点击需确认"
                    : undefined
                }
              >
                {balanceLoading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4 mr-1" />
                )}
                额度
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(subscription)}
            >
              <Edit className="h-4 w-4 mr-1" />
              编辑
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmStep(1)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              删除
            </Button>
          </div>
        </CardContent>
      </Card>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>再次查询确认</DialogTitle>
            <DialogDescription>
              距上次查询不足 60 秒，确定要再次查询吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button onClick={handleConfirmQuery}>确认查询</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteConfirmStep > 0}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmStep(0);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteConfirmStep === 1 ? "确认删除订阅" : "再次确认删除"}
            </DialogTitle>
            <DialogDescription>
              {deleteConfirmStep === 1
                ? `确定要删除订阅「${subscription.name}」吗？`
                : `删除后无法恢复「${subscription.name}」，确定继续吗？`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmStep(0)}>
              取消
            </Button>
            {deleteConfirmStep === 1 ? (
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirmStep(2)}
              >
                继续删除
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => {
                  setDeleteConfirmStep(0);
                  onDelete(subscription.id);
                }}
              >
                确认删除
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
