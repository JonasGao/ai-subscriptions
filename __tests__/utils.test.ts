import { describe, it, expect } from "vitest";
import {
  getUsagePercent,
  getProgressTier,
  PROGRESS_WARNING_THRESHOLD,
  PROGRESS_DANGER_THRESHOLD,
  getCurrencySymbol,
  formatBalance,
  getProviderCurrency,
  getResetUrgencyColor,
  RESET_URGENCY_THRESHOLDS,
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

// ============ getResetUrgencyColor ============

const HOUR = 3_600_000;

describe("getResetUrgencyColor", () => {
  describe("threshold constants", () => {
    it("matches the spec values", () => {
      expect(RESET_URGENCY_THRESHOLDS.weekly.redHours).toBe(24);
      expect(RESET_URGENCY_THRESHOLDS.weekly.yellowHours).toBe(72);
      expect(RESET_URGENCY_THRESHOLDS.monthly.redHours).toBe(120);
      expect(RESET_URGENCY_THRESHOLDS.monthly.yellowHours).toBe(240);
    });
  });

  describe("boundary points", () => {
    it("weekly exactly 72h → null", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 72 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBeNull();
    });

    it("weekly exactly 24h → interpolation endpoint, soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 24 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });

    it("monthly exactly 240h → null", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 240 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBeNull();
    });

    it("monthly exactly 120h → interpolation endpoint, soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 120 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });
  });

  describe("red clamp", () => {
    it("weekly 1h remaining → soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 1 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });

    it("monthly 24h remaining → soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 24 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });

    it("expired (past resetTime) → soft red", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now - 1 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(0, 65%, 55%)"
      );
    });
  });

  describe("midpoint interpolation", () => {
    it("weekly 48h remaining → hsl(28, 82.6%, 65%)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 48 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(28, 82.6%, 65%)"
      );
    });

    it("monthly 180h remaining → hsl(28, 82.6%, 65%)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 180 * HOUR).toISOString();
      expect(getResetUrgencyColor("monthly", resetTime, now)).toBe(
        "hsl(28, 82.6%, 65%)"
      );
    });
  });

  describe("exponential easing", () => {
    it("weekly 60h (x=0.25) → hue ≈ 39, slower than linear (36)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 60 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(39, 89.3%, 68.8%)"
      );
    });

    it("weekly 36h (x=0.75) → hue ≈ 15, steep catch-up vs linear (12)", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 36 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(15, 74.5%, 60.4%)"
      );
    });

    it("weekly 30h (x≈0.875) → hue ≈ 8, accelerating toward red endpoint", () => {
      const now = 1_000_000_000_000;
      const resetTime = new Date(now + 30 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, now)).toBe(
        "hsl(8, 70%, 57.8%)"
      );
    });
  });

  describe("gradient monotonicity", () => {
    it("hue decreases as remaining time decreases (weekly)", () => {
      const now = 1_000_000_000_000;
      const hours = [66, 60, 54, 48, 42, 36, 30];
      const hues = hours.map((h) => {
        const resetTime = new Date(now + h * HOUR).toISOString();
        const color = getResetUrgencyColor("weekly", resetTime, now)!;
        return parseInt(color.match(/hsl\((\d+)/)![1], 10);
      });
      for (let i = 1; i < hues.length; i++) {
        expect(hues[i]).toBeLessThanOrEqual(hues[i - 1]);
      }
    });
  });

  describe("edge cases", () => {
    it("null resetTime → null", () => {
      expect(getResetUrgencyColor("weekly", null)).toBeNull();
      expect(getResetUrgencyColor("monthly", null)).toBeNull();
    });

    it("now parameter injection produces deterministic results", () => {
      const fixedNow = 1_700_000_000_000;
      const resetTime = new Date(fixedNow + 48 * HOUR).toISOString();
      expect(getResetUrgencyColor("weekly", resetTime, fixedNow)).toBe(
        "hsl(28, 82.6%, 65%)"
      );
    });

    it("invalid ISO string → null", () => {
      expect(getResetUrgencyColor("weekly", "not-a-date")).toBeNull();
    });
  });
});
