// Port of the balance-formatting helpers in lib/utils.ts.
import type { Subscription } from "./types";

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  KRW: "₩",
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOL_MAP[currency] ?? currency;
}

export function formatBalance(
  amount: string | number,
  currency: string
): string {
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  const safe = Number.isFinite(num) ? num : 0;
  return `${getCurrencySymbol(currency)}${safe.toFixed(2)}`;
}

const PROVIDER_CURRENCY_MAP: Record<string, string> = {
  moonshot: "CNY",
  siliconflow: "CNY",
};

export function getProviderCurrency(provider: string): string {
  return PROVIDER_CURRENCY_MAP[provider] ?? "USD";
}

/** calculateMonthlyTotal sums recurring subscriptions, yearly prices / 12. */
export function calculateMonthlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((subscription) => subscription.subscriptionType === "recurring")
    .reduce(
      (total, subscription) =>
        total +
        (subscription.billingCycle === "yearly"
          ? subscription.price / 12
          : subscription.price),
      0
    );
}

/** calculateYearlyTotal annualizes monthly prices (×12) and sums them. */
export function calculateYearlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((subscription) => subscription.subscriptionType === "recurring")
    .reduce(
      (total, subscription) =>
        total +
        (subscription.billingCycle === "monthly"
          ? subscription.price * 12
          : subscription.price),
      0
    );
}

/** calculateOneTimeTotal sums the balance of every one-time top-up. */
export function calculateOneTimeTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((subscription) => subscription.subscriptionType === "one-time")
    .reduce((total, subscription) => total + (subscription.balance ?? 0), 0);
}
