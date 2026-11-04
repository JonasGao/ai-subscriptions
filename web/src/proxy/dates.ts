// Port of lib/proxy-utils.ts (the client-side half). The Go server owns the
// authoritative copies in server/internal/proxy; these mirror them so the form
// can preview a calculated date and a card can show a notice without a round
// trip, exactly like the old stack shared lib/proxy-utils.ts.

export type ProxySubscriptionStatus = "unused" | "in-use" | "expired";

export interface ProxyDateNotice {
  kind: "none" | "today" | "remaining" | "overdue";
  days?: number;
}

/** isDateOnly rejects impossible calendar days such as 2026-02-30. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** addCalendarDays shifts a date-only string by whole days. */
export function addCalendarDays(dateOnly: string, days: number): string {
  if (!isDateOnly(dateOnly) || !Number.isInteger(days)) {
    throw new Error("Invalid date or day count");
  }
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** calculateProxyExpirationDate writes the inclusive expiration date. */
export function calculateProxyExpirationDate(
  startDate: string,
  durationDays: number
): string {
  if (!isDateOnly(startDate)) throw new Error("起始日期必须是 YYYY-MM-DD 格式");
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error("订阅天数必须是正整数");
  }
  return addCalendarDays(startDate, durationDays - 1);
}

/** getProxyTodayDate returns the China-local calendar date. */
export function getProxyTodayDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * getProxyDateNotice only reports anything for a manually In Use record with a
 * valid expiration date; unlimited (no date) and Unused records are out of
 * expiry processing entirely (ADR-0009).
 */
export function getProxyDateNotice(
  subscription: {
    status: ProxySubscriptionStatus;
    expirationDate?: string;
  },
  now = new Date()
): ProxyDateNotice {
  if (subscription.status !== "in-use") return { kind: "none" };
  if (!subscription.expirationDate) return { kind: "none" };
  if (!isDateOnly(subscription.expirationDate)) return { kind: "none" };
  const today = getProxyTodayDate(now);
  const expiration = new Date(`${subscription.expirationDate}T00:00:00Z`);
  const current = new Date(`${today}T00:00:00Z`);
  const difference = Math.round(
    (expiration.getTime() - current.getTime()) / 86400000
  );
  if (difference < 0) return { kind: "overdue", days: Math.abs(difference) };
  if (difference === 0) return { kind: "today" };
  return { kind: "remaining", days: difference };
}
