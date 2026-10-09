"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Subscription, defaultProviders, Tag } from "@/lib/types";
import { useNow } from "@/hooks/useNow";
import {
  formatDate,
  isExpiringSoon,
  getDaysUntilRenewal,
  getStatusReason,
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
import {
  ReQueryConfirmDialog,
  DeleteConfirmDialog,
} from "@/components/subscription-card/dialogs";
import { useSubscriptionQuery } from "@/components/subscription-card/useSubscriptionQuery";

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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

  const {
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
  } = useSubscriptionQuery({
    subscription,
    canQuery,
    onEdit,
    onScheduleToggle,
    onBalanceUpdate,
  });

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

  const handleStatusToggle = () => {
    if (!canToggleStatus) return;
    const newStatus = subscription.status === "active" ? "paused" : "active";
    onStatusChange(subscription.id, newStatus);
  };

  return (
    <TooltipProvider>
      <Card
        className={`subscription-card flex flex-col w-full ${expiringSoon ? "border-orange-500 border-2" : ""}`}
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
                  onToggle={toggleSchedule}
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
                    : "查询额度"
                }
              >
                {balanceLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                <span className="card-action-label ml-1">额度</span>
              </Button>
            )}
            {canQueryModels && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleModelsClick}
                title="模型列表"
              >
                <Boxes className="h-4 w-4" />
                <span className="card-action-label ml-1">模型</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(subscription)}
              title="编辑"
            >
              <Edit className="h-4 w-4" />
              <span className="card-action-label ml-1">编辑</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
              <span className="card-action-label ml-1">删除</span>
            </Button>
          </div>
        </CardContent>
      </Card>
      <ReQueryConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleConfirmQuery}
      />
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        subscriptionName={subscription.name}
        onDelete={() => onDelete(subscription.id)}
      />
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
