import { ProxySubscription } from "./types";

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addCalendarDays(dateOnly: string, days: number): string {
  if (!isDateOnly(dateOnly) || !Number.isInteger(days))
    throw new Error("Invalid date or day count");
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calculateProxyExpirationDate(
  startDate: string,
  durationDays: number
): string {
  if (!isDateOnly(startDate)) throw new Error("起始日期必须是 YYYY-MM-DD 格式");
  if (!Number.isInteger(durationDays) || durationDays < 1)
    throw new Error("订阅天数必须是正整数");
  return addCalendarDays(startDate, durationDays - 1);
}

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

export type ProxyDateNotice =
  | { kind: "none" }
  | { kind: "today" }
  | { kind: "remaining"; days: number }
  | { kind: "overdue"; days: number };

export function getProxyDateNotice(
  subscription: Pick<ProxySubscription, "status" | "expirationDate">,
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
