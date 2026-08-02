"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Subscription, defaultProviders, BalanceResult } from "@/lib/types";
import {
  formatDate,
  isExpiringSoon,
  getDaysUntilRenewal,
  formatNextResetTime,
  getScheduleTypeLabel,
  getStatusReason,
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

export function SubscriptionCard({
  subscription,
  onEdit,
  onDelete,
  onStatusChange,
  onScheduleToggle,
}: SubscriptionCardProps) {
  const [balance, setBalance] = useState<BalanceResult | null>(null);
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
  const isBalanceSupported = ["deepseek", "moonshot", "openrouter"].includes(
    subscription.provider
  );
  const isOneTime = subscription.subscriptionType === "one-time";
  const canToggleStatus =
    subscription.status === "active" || subscription.status === "paused";
  const statusReason = getStatusReason(subscription);

  const handleQueryBalance = async () => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
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
    <Card
      className={`flex flex-col min-w-[280px] ${expiringSoon ? "border-orange-500 border-2" : ""}`}
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
            <span className="text-sm font-medium">{subscription.category}</span>
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
                {isBalanceSupported
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
          {isBalanceSupported &&
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
                        <span className="text-muted-foreground self-center">
                          {formatNextResetTime(schedule.nextResetTime)}
                        </span>
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
          {isBalanceSupported && (
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
  );
}
