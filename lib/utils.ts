import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Subscription, EffectiveStatusReason } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function calculateMonthlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((s) => s.status === "active" && s.subscriptionType === "recurring")
    .reduce((total, s) => {
      const monthlyPrice = s.billingCycle === "yearly" ? s.price / 12 : s.price;
      return total + monthlyPrice;
    }, 0);
}

export function calculateYearlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((s) => s.status === "active" && s.subscriptionType === "recurring")
    .reduce((total, s) => {
      const yearlyPrice = s.billingCycle === "monthly" ? s.price * 12 : s.price;
      return total + yearlyPrice;
    }, 0);
}

export function calculateOneTimeTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((s) => s.status === "active" && s.subscriptionType === "one-time")
    .reduce((total, s) => total + s.price, 0);
}

export function calculateCategoryStats(
  subscriptions: Subscription[]
): Record<string, number> {
  const stats: Record<string, number> = {};

  subscriptions
    .filter((s) => s.status === "active")
    .forEach((s) => {
      if (!stats[s.category]) {
        stats[s.category] = 0;
      }
      if (s.subscriptionType === "recurring") {
        const monthlyPrice =
          s.billingCycle === "yearly" ? s.price / 12 : s.price;
        stats[s.category] += monthlyPrice;
      } else {
        stats[s.category] += s.price;
      }
    });

  return stats;
}

export function getDaysUntilRenewal(renewalDate: string): number {
  const renewal = new Date(renewalDate);
  const today = new Date();
  const diffTime = renewal.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export function isExpiringSoon(renewalDate: string): boolean {
  const days = getDaysUntilRenewal(renewalDate);
  return days >= 0 && days <= 7;
}

export function formatDate(dateString?: string): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatNextResetTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 0) {
    return "即将重置";
  } else if (diffMins < 60) {
    return `${diffMins}分钟后重置`;
  } else if (diffHours < 24) {
    if (remainingMins === 0) {
      return `${diffHours}小时后重置`;
    }
    return `${diffHours}小时${remainingMins}分钟后重置`;
  } else {
    const remainingHours = diffHours % 24;

    if (remainingHours === 0 && remainingMins === 0) {
      return `${diffDays}天后重置`;
    } else if (remainingMins === 0) {
      return `${diffDays}天${remainingHours}小时后重置`;
    } else if (remainingHours === 0) {
      return `${diffDays}天${remainingMins}分钟后重置`;
    }
    return `${diffDays}天${remainingHours}小时${remainingMins}分钟后重置`;
  }
}

const TIMEZONE_ABBR_MAP: Record<string, string> = {
  "Asia/Shanghai": "上海时间",
  "Asia/Hong_Kong": "香港时间",
  "Asia/Tokyo": "东京时间",
  "America/New_York": "纽约时间",
  "America/Los_Angeles": "洛杉矶时间",
  "Europe/London": "伦敦时间",
  UTC: "UTC",
};

export function getTimezoneAbbr(timezone?: string): string {
  if (!timezone) return "";
  return TIMEZONE_ABBR_MAP[timezone] || timezone.split("/").pop() || timezone;
}

function getUtcOffset(date: Date, timezone: string): string {
  try {
    const parts = Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
      hour12: false,
    }).formatToParts(date);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    if (!offsetPart) return "";
    return offsetPart.value.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

export function formatResetTimeTooltip(
  isoString: string,
  timezone?: string
): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };

  if (!timezone) {
    return date.toLocaleString("zh-CN", options);
  }

  try {
    const dateText = date.toLocaleString("zh-CN", {
      ...options,
      timeZone: timezone,
    });
    const suffix =
      TIMEZONE_ABBR_MAP[timezone] ||
      getUtcOffset(date, timezone) ||
      getTimezoneAbbr(timezone);
    return `${dateText} (${suffix})`;
  } catch {
    return date.toLocaleString("zh-CN", options);
  }
}

export function getScheduleTypeLabel(type: string): string {
  switch (type) {
    case "fiveHour":
      return "每5小时";
    case "daily":
      return "每日";
    case "weekly":
      return "每周";
    case "monthly":
      return "每月";
    default:
      return type;
  }
}

export function getStatusReason(
  subscription: Subscription
): EffectiveStatusReason {
  if (subscription.status === "cancelled") {
    return { kind: "manual-cancelled" };
  }

  const enabledSchedules =
    subscription.resetSchedules?.filter((s) => s.enabled) ?? [];
  const exhaustedSchedules = enabledSchedules.filter(
    (s) => s.exhausted === true
  );

  if (exhaustedSchedules.length > 0) {
    return {
      kind: "schedule-exhausted",
      scheduleIds: exhaustedSchedules.map((s) => s.id),
    };
  }

  if (subscription.status === "paused") {
    return { kind: "manual-paused" };
  }

  return { kind: "available" };
}

// ============ Usage progress helpers ============

/** Usage ratio at which the progress bar turns warning (>=). */
export const PROGRESS_WARNING_THRESHOLD = 70;
/** Usage ratio above which the progress bar turns danger (>). */
export const PROGRESS_DANGER_THRESHOLD = 90;

/**
 * Compute the exact usage ratio (0-100, unrounded) from used/limit values.
 * Returns null when the ratio cannot be computed (missing/zero/invalid
 * limit, or non-numeric used), so the caller can fall back to plain numbers.
 * The caller rounds for display width; tier classification must use the
 * exact ratio so band-edge values (e.g. 69.9%, 90.4%) are not misclassified.
 */
export function getUsagePercent(
  used: string | undefined,
  limit: string | undefined
): number | null {
  if (
    used == null ||
    limit == null ||
    used.trim() === "" ||
    limit.trim() === ""
  ) {
    return null;
  }
  const usedNum = Number(used);
  const limitNum = Number(limit);
  if (
    !Number.isFinite(usedNum) ||
    !Number.isFinite(limitNum) ||
    limitNum <= 0
  ) {
    return null;
  }
  if (usedNum <= 0) return 0;
  return Math.min(100, (usedNum / limitNum) * 100);
}

export type ProgressTier = "normal" | "warning" | "danger";

/** Map an exact usage ratio to a visual tier: normal, warning, danger. */
export function getProgressTier(percent: number): ProgressTier {
  if (percent > PROGRESS_DANGER_THRESHOLD) return "danger";
  if (percent >= PROGRESS_WARNING_THRESHOLD) return "warning";
  return "normal";
}
