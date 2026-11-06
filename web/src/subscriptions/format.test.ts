// Port of the currency/balance cases from __tests__/utils.test.ts (7 cases:
// getCurrencySymbol 2, formatBalance 3, getProviderCurrency 2).

import { describe, expect, it } from "vitest";
import {
  calculateOneTimeTotal,
  formatBalance,
  getCurrencySymbol,
  getProviderCurrency,
} from "./format";
import type { Subscription } from "./types";

describe("getCurrencySymbol", () => {
  it("returns the correct symbol for known currencies", () => {
    expect(getCurrencySymbol("CNY")).toBe("¥");
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("EUR")).toBe("€");
    expect(getCurrencySymbol("GBP")).toBe("£");
    expect(getCurrencySymbol("JPY")).toBe("¥");
  });

  it("returns the code itself for unknown currencies", () => {
    expect(getCurrencySymbol("BTC")).toBe("BTC");
    expect(getCurrencySymbol("XYZ")).toBe("XYZ");
  });
});

describe("formatBalance", () => {
  it("formats a numeric amount with the currency symbol and 2 decimals", () => {
    expect(formatBalance(399, "CNY")).toBe("¥399.00");
    expect(formatBalance(42.5, "USD")).toBe("$42.50");
    expect(formatBalance(0, "EUR")).toBe("€0.00");
  });

  it("parses a string amount", () => {
    expect(formatBalance("399.5", "CNY")).toBe("¥399.50");
    expect(formatBalance("10", "USD")).toBe("$10.00");
  });

  it("coerces non-numeric strings to 0", () => {
    expect(formatBalance("abc", "USD")).toBe("$0.00");
    expect(formatBalance("", "CNY")).toBe("¥0.00");
  });
});

describe("getProviderCurrency", () => {
  it("returns CNY for moonshot and siliconflow", () => {
    expect(getProviderCurrency("moonshot")).toBe("CNY");
    expect(getProviderCurrency("siliconflow")).toBe("CNY");
  });

  it("defaults to USD for other providers", () => {
    expect(getProviderCurrency("openrouter")).toBe("USD");
    expect(getProviderCurrency("deepseek")).toBe("USD");
    expect(getProviderCurrency("unknown")).toBe("USD");
  });
});

/**
 * #3195007: a one-time subscription carries price 0; its amount lives in
 * balance. calculateOneTimeTotal must sum balances, never prices.
 */
function oneTime(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "one-time",
    name: "一次性订阅",
    category: "编程",
    provider: "deepseek",
    subscriptionType: "one-time",
    price: 0,
    status: "active",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

describe("calculateOneTimeTotal", () => {
  it("sums balance across one-time subscriptions and ignores price", () => {
    expect(
      calculateOneTimeTotal([
        oneTime({ id: "a", price: 0, balance: 50 }),
        oneTime({ id: "b", price: 0, balance: 30 }),
      ])
    ).toBe(80);
  });

  it("does not fall back to price when balance is absent", () => {
    expect(calculateOneTimeTotal([oneTime({ price: 500 })])).toBe(0);
  });

  it("treats a missing balance as zero and skips recurring subscriptions", () => {
    expect(
      calculateOneTimeTotal([
        oneTime({ id: "a", balance: 12.5 }),
        oneTime({ id: "b" }),
        { ...oneTime({ id: "c" }), subscriptionType: "recurring", price: 99 },
      ])
    ).toBe(12.5);
  });

  it("returns zero for an empty list", () => {
    expect(calculateOneTimeTotal([])).toBe(0);
  });
});
