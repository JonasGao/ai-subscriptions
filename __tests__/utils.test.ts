import { describe, it, expect } from "vitest";
import {
  getUsagePercent,
  getProgressTier,
  PROGRESS_WARNING_THRESHOLD,
  PROGRESS_DANGER_THRESHOLD,
  getCurrencySymbol,
  formatBalance,
  getProviderCurrency,
} from "@/lib/utils";

describe("getUsagePercent", () => {
  it("computes the exact used/limit ratio, unrounded", () => {
    expect(getUsagePercent("50", "100")).toBe(50);
    expect(getUsagePercent("1", "3")).toBeCloseTo(33.333, 2);
    expect(getUsagePercent("0", "100")).toBe(0);
  });

  it("clamps to 100 when used exceeds limit", () => {
    expect(getUsagePercent("150", "100")).toBe(100);
  });

  it("returns null when limit is missing, zero, or negative", () => {
    expect(getUsagePercent("10", "")).toBeNull();
    expect(getUsagePercent("10", "0")).toBeNull();
    expect(getUsagePercent("10", "-5")).toBeNull();
    expect(getUsagePercent("10", "abc")).toBeNull();
    expect(getUsagePercent("10", undefined)).toBeNull();
  });

  it("returns null when used is non-numeric", () => {
    expect(getUsagePercent("unlimited", "100")).toBeNull();
    expect(getUsagePercent("", "100")).toBeNull();
    expect(getUsagePercent("abc", "100")).toBeNull();
    expect(getUsagePercent(undefined, "100")).toBeNull();
  });
});

describe("getProgressTier", () => {
  it("uses the documented thresholds", () => {
    expect(PROGRESS_WARNING_THRESHOLD).toBe(70);
    expect(PROGRESS_DANGER_THRESHOLD).toBe(90);
  });

  it("returns normal below 70", () => {
    expect(getProgressTier(0)).toBe("normal");
    expect(getProgressTier(69.9)).toBe("normal");
  });

  it("returns warning from 70 to 90", () => {
    expect(getProgressTier(70)).toBe("warning");
    expect(getProgressTier(90)).toBe("warning");
  });

  it("returns danger above 90", () => {
    expect(getProgressTier(90.1)).toBe("danger");
    expect(getProgressTier(100)).toBe("danger");
  });
});

describe("tier follows the exact ratio, not the rounded percent", () => {
  it("69.9% stays normal even though it rounds to 70", () => {
    expect(getUsagePercent("699", "1000")).toBeCloseTo(69.9, 1);
    expect(getProgressTier(getUsagePercent("699", "1000") as number)).toBe(
      "normal"
    );
  });

  it("90.4% is danger even though it rounds to 90", () => {
    expect(getUsagePercent("904", "1000")).toBeCloseTo(90.4, 1);
    expect(getProgressTier(getUsagePercent("904", "1000") as number)).toBe(
      "danger"
    );
  });
});

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
