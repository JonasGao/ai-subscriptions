// Port of the balance-formatting helpers in lib/utils.ts.

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
