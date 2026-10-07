import { UsageResult, UsageWindow } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatNextResetTime,
  formatResetTimeTooltip,
  getUsagePercent,
  getProgressTier,
  getResetUrgencyColor,
  type ProgressTier,
} from "@/lib/utils";
import { Clock } from "lucide-react";

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

function UsageProgressBar({
  window,
  kind,
}: {
  window: UsageWindow;
  kind?: "fiveHour" | "weekly" | "monthly";
}) {
  const percent = getUsagePercent(window.used, window.limit);
  const tier = percent === null ? null : getProgressTier(percent);
  const width = percent === null ? 0 : Math.round(percent);
  const percentLabel = percent === null ? null : `${percent.toFixed(1)}%`;

  // Only weekly/monthly get urgency coloring; fiveHour/undefined → no color
  const urgencyColor =
    kind === "weekly" || kind === "monthly"
      ? getResetUrgencyColor(kind, window.resetTime)
      : null;
  const clockColorStyle = urgencyColor ? { color: urgencyColor } : undefined;
  const resetTextColorStyle = urgencyColor
    ? { color: urgencyColor }
    : undefined;

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
        <Clock
          className="h-3 w-3 text-muted-foreground"
          style={clockColorStyle}
        />
        {window.resetTime ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="cursor-default text-xs text-muted-foreground"
                style={resetTextColorStyle}
              >
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
        {percentLabel !== null && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {percentLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function UsageBlock({
  label,
  window,
  kind,
}: {
  label: string;
  window: UsageWindow;
  kind?: "fiveHour" | "weekly" | "monthly";
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <UsageAmountText window={window} />
      </div>
      <UsageProgressBar window={window} kind={kind} />
    </div>
  );
}

export function UsageSection({ usage }: { usage: UsageResult }) {
  return (
    <div className="pt-2 space-y-2">
      {usage.fiveHour && (
        <UsageBlock label="5小时" window={usage.fiveHour} kind="fiveHour" />
      )}
      {usage.weekly && (
        <UsageBlock label="周" window={usage.weekly} kind="weekly" />
      )}
      {usage.monthly && (
        <UsageBlock label="月" window={usage.monthly} kind="monthly" />
      )}
      {usage.boosterWallet && (
        <div>
          <span className="text-sm text-muted-foreground">加速包</span>
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">剩余额度</span>
              <span className="text-sm font-medium">
                {usage.boosterWallet.balance
                  ? `${formatUsageAmount(usage.boosterWallet.balance.amountLeft)} ${getUsageUnitLabel(usage.boosterWallet.balance.unit)}`
                  : "-"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">本月已用</span>
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
          <span className="text-sm text-muted-foreground">并行上限</span>
          <span className="text-sm font-medium">{usage.parallel.limit}</span>
        </div>
      )}
      {usage.membership && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">会员等级</span>
          <span className="text-sm font-medium">
            {formatMembershipLevel(usage.membership.level)}
          </span>
        </div>
      )}
    </div>
  );
}
