"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  Tag,
} from "@/lib/types";
import { useNow } from "@/hooks/useNow";
import {
  formatDate,
  isExpiringSoon,
  getDaysUntilRenewal,
  getStatusReason,
  getProviderCurrency,
} from "@/lib/utils";
import {
  resolveUsageApiUrl,
  resolveModelsApiUrl,
  resolveModelsRequireCredentials,
} from "@/lib/api-url-resolver";
import {
  Edit,
  Trash2,
  Wallet,
  Loader2,
  AlertCircle,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { ModelListDialog } from "@/components/ModelListDialog";
import {
  getStatusBadgeVariant,
  getStatusLabel,
  getProviderName,
  getPlanName,
  getTypeLabel,
} from "@/components/subscription-card/card-labels";
import { UsageSection } from "@/components/subscription-card/usage-display";
import {
  BalanceInfoRows,
  OneTimeBalanceRow,
} from "@/components/subscription-card/balance-display";
import { ResetScheduleGrid } from "@/components/subscription-card/reset-schedule-grid";

interface SubscriptionCardProps {
  subscription: Subscription;
  tags?: Tag[];
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

export function SubscriptionCard({
  subscription,
  tags = [],
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
  const [modelsDialogOpen, setModelsDialogOpen] = useState(false);
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
  const subscriptionTags = (subscription.tagIds ?? [])
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is Tag => Boolean(tag));
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
      : providerConfig
        ? !!resolveUsageApiUrl(providerConfig, subscription.planId)
        : false;
  const canQueryModels = providerConfig
    ? !!resolveModelsApiUrl(providerConfig, subscription.planId)
    : false;
  const modelsRequireCredentials = providerConfig
    ? resolveModelsRequireCredentials(providerConfig, subscription.planId)
    : true;
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

  const handleModelsClick = () => {
    // If the endpoint needs credentials and none are configured, open the
    // edit dialog. Public endpoints (modelsRequireCredentials: false) skip
    // this and open the model list directly.
    if (modelsRequireCredentials && !subscription.hasCredentials) {
      onEdit(subscription);
      return;
    }
    setModelsDialogOpen(true);
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
            {subscriptionTags.length > 0 && (
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 pt-1 text-sm text-muted-foreground">
                  标签
                </span>
                <div className="flex min-w-0 flex-wrap justify-end gap-1">
                  {subscriptionTags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="max-w-full break-all text-xs"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
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
              <OneTimeBalanceRow
                subscription={subscription}
                balance={balance}
                previousBalance={previousBalance}
              />
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
            {canQuery && balance && (
              <BalanceInfoRows balanceInfos={balance.balanceInfos} />
            )}
            {usage && <UsageSection usage={usage} />}
            {balanceError && (
              <div className="text-sm text-red-500">{balanceError}</div>
            )}
            {subscription.notes && (
              <div className="pt-2">
                <span className="text-sm text-muted-foreground">备注</span>
                <p className="text-sm mt-1 whitespace-pre-wrap break-words">
                  {subscription.notes}
                </p>
              </div>
            )}
            {subscription.resetSchedules &&
              subscription.resetSchedules.length > 0 && (
                <ResetScheduleGrid
                  schedules={subscription.resetSchedules}
                  onToggle={handleScheduleToggle}
                />
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
            {canQueryModels && (
              <Button variant="outline" size="sm" onClick={handleModelsClick}>
                <Boxes className="h-4 w-4 mr-1" />
                模型
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
      {canQueryModels && (
        <ModelListDialog
          open={modelsDialogOpen}
          onOpenChange={setModelsDialogOpen}
          subscriptionId={subscription.id}
        />
      )}
    </TooltipProvider>
  );
}
