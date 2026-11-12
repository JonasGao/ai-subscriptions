// Port of the usage-progress cases from __tests__/utils.test.ts (10 cases:
// getUsagePercent 4, getProgressTier 4, exact-ratio tier 2). The reset-urgency
// half of that file lives in reset.test.ts.

import { describe, expect, it } from "vitest";
import {
  getAmountPercent,
  getProgressTier,
  getUsagePercent,
  PROGRESS_DANGER_THRESHOLD,
  PROGRESS_WARNING_THRESHOLD,
} from "./usage";

describe("getAmountPercent (one-time额度 bar)", () => {
  it("computes the current/total ratio, unrounded", () => {
    expect(getAmountPercent(50, 100)).toBe(50);
    expect(getAmountPercent(1, 3)).toBeCloseTo(33.333, 2);
    expect(getAmountPercent(0, 100)).toBe(0);
  });

  it("clamps to 100 when the current value exceeds the total", () => {
    expect(getAmountPercent(150, 100)).toBe(100);
    expect(getAmountPercent(100, 100)).toBe(100);
  });

  it("returns null when total is missing, zero, negative or non-finite", () => {
    expect(getAmountPercent(10, null)).toBeNull();
    expect(getAmountPercent(10, undefined)).toBeNull();
    expect(getAmountPercent(10, 0)).toBeNull();
    expect(getAmountPercent(10, -5)).toBeNull();
    expect(getAmountPercent(10, NaN)).toBeNull();
  });

  it("returns null when current is missing or non-finite", () => {
    expect(getAmountPercent(null, 100)).toBeNull();
    expect(getAmountPercent(undefined, 100)).toBeNull();
    expect(getAmountPercent(NaN, 100)).toBeNull();
  });
});

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
