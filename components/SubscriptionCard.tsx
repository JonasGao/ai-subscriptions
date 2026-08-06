"use client";

import { useState } from "react";
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
  type ProgressTier,
} from "@/lib/utils";
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
  ) => void;
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

function getTimeUnitLabel(timeUnit: string): string {
  switch (timeUnit) {
    case "TIME_UNIT_SECOND":
      return "秒";
    case "TIME_UNIT_MINUTE":
      return "分钟";
    case "TIME_UNIT_HOUR":
      return "小时";
    case "TIME_UNIT_DAY":
      return "天";
    default:
      return timeUnit;
  }
}

function formatLimitWindowDuration(duration: number, timeUnit: string): string {
  if (timeUnit === "TIME_UNIT_MINUTE" && duration % 60 === 0) {
    return `${duration / 60} 小时`;
  }
  return `${duration} ${getTimeUnitLabel(timeUnit)}`;
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
      {window.resetTime && (
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-muted-foreground" />
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
        </div>
      )}
    </div>
  );
}

export function SubscriptionCard({
  subscription,
  onEdit,
  onDelete,
  onStatusChange,
  onScheduleToggle,
}: SubscriptionCardProps) {
  // Re-render periodically so formatNextResetTime (which uses new Date()) updates
  useNow();
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
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
      : !!providerConfig?.usageApiUrl;
  const isOneTime = subscription.subscriptionType === "one-time";
  const canToggleStatus =
    subscription.status === "active" || subscription.status === "paused";
  const statusReason = getStatusReason(subscription);

  const handleQueryBalance = async () => {
    // If credentials are not configured, open the edit dialog
    if (!subscription.hasCredentials) {
      onEdit(subscription);
      return;
    }
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
      setBalance(data);
      const total = data.balanceInfos.reduce(
        (sum, i) => sum + parseFloat(i.totalBalance || "0"),
        0
      );
      await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: total }),
      });
    } catch {
      setBalanceError("网络请求失败");
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleStatusToggle = () => {
    if (!canToggleStatus) return;
    const newStatus = subscription.status === "active" ? "paused" : "active";
    onStatusChange(subscription.id, newStatus);
  };

  const handleScheduleToggle = (scheduleId: string, exhausted: boolean) => {
    if (onScheduleToggle) {
      onScheduleToggle(subscription.id, scheduleId, exhausted);
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
                  {canQuery
                    ? balance
                      ? `¥${balance.balanceInfos.reduce((s, i) => s + parseFloat(i.totalBalance || "0"), 0).toFixed(2)}`
                      : subscription.balance != null
                        ? `¥${subscription.balance.toFixed(2)}`
                        : "-"
                    : subscription.balance != null
                      ? `¥${subscription.balance.toFixed(2)}`
                      : "-"}
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
                  {balance.provider === "moonshot" ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          可用余额
                        </span>
                        <span className="text-sm font-medium text-green-600">
                          ¥{info.totalBalance}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          代金券
                        </span>
                        <span className="text-sm font-medium">
                          ¥{info.grantedBalance}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          现金余额
                        </span>
                        <span className="text-sm font-medium">
                          ¥{info.toppedUpBalance}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        余额 ({info.currency})
                      </span>
                      <span className="text-sm font-medium text-green-600">
                        ${info.totalBalance}
                      </span>
                    </div>
                  )}
                </Fragment>
              ))}
            {usage && (
              <>
                {usage.usage && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        周用量
                      </span>
                      <UsageAmountText window={usage.usage} />
                    </div>
                    <UsageProgressBar window={usage.usage} />
                  </div>
                )}
                {usage.limits.length > 0 && (
                  <div className="pt-2">
                    <span className="text-sm text-muted-foreground">
                      5小时频限
                    </span>
                    {usage.limits.map((limit, index) => (
                      <div key={index} className="mt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {formatLimitWindowDuration(
                              limit.window.duration,
                              limit.window.timeUnit
                            )}
                          </span>
                          <UsageAmountText window={limit.detail} />
                        </div>
                        <UsageProgressBar window={limit.detail} />
                      </div>
                    ))}
                  </div>
                )}
                {usage.boosterWallet && (
                  <div className="pt-2">
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
              </>
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
                    {subscription.resetSchedules
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
                onClick={handleQueryBalance}
                disabled={balanceLoading}
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
              onClick={() => onDelete(subscription.id)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              删除
            </Button>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
