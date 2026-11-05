// The usage window rendering the old stack had: a percentage label and a
// threshold-colored progress bar, both hidden when the ratio cannot be
// computed (missing/zero/negative limit). These cases lock the semantics that
// the previous private `usagePercent` helper silently changed.

import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { UsageWindows } from "./query-display";
import type { UsageWindow } from "../subscriptions/types";

function makeWindow(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return {
    limit: "100",
    used: "50",
    remaining: "50",
    resetTime: null,
    ...overrides,
  };
}

describe("UsageWindows", () => {
  afterEach(cleanup);

  it("hides the percent label and bar when the ratio cannot be computed", () => {
    const result = render(() => (
      <UsageWindows
        usage={{
          fiveHour: makeWindow({ used: "10", limit: "0" }),
          weekly: null,
          monthly: null,
        }}
      />
    ));

    expect(result.container.querySelector(".usage-percent")).toBeNull();
    expect(result.container.querySelector(".usage-progress")).toBeNull();
    // The raw amounts still render.
    expect(result.container.textContent).toContain("10 / 0");
  });

  it("renders the exact ratio rounded for display (old toFixed(1))", () => {
    const result = render(() => (
      <UsageWindows
        usage={{
          fiveHour: makeWindow({ used: "1", limit: "3" }),
          weekly: null,
          monthly: null,
        }}
      />
    ));

    expect(result.container.querySelector(".usage-percent")!.textContent).toBe(
      "33.3%"
    );
  });

  it("applies normal/warning/danger tiers at the 70/90 thresholds", () => {
    const result = render(() => (
      <UsageWindows
        usage={{
          fiveHour: makeWindow({ used: "50", limit: "100" }),
          weekly: makeWindow({ used: "70", limit: "100" }),
          monthly: makeWindow({ used: "90", limit: "100" }),
        }}
      />
    ));

    const fills = result.container.querySelectorAll(".usage-progress-fill");
    expect(fills.length).toBe(3);
    expect(fills[0].classList.contains("normal")).toBe(true);
    expect(fills[1].classList.contains("warning")).toBe(true);
    // 90 exactly is still warning; danger requires > 90.
    expect(fills[2].classList.contains("warning")).toBe(true);
  });

  it("classifies using the exact ratio, not the rounded percent", () => {
    const result = render(() => (
      <UsageWindows
        usage={{
          fiveHour: null,
          weekly: makeWindow({ used: "699", limit: "1000" }),
          monthly: makeWindow({ used: "904", limit: "1000" }),
        }}
      />
    ));

    const fills = result.container.querySelectorAll(".usage-progress-fill");
    expect(fills[0].classList.contains("normal")).toBe(true);
    expect(fills[1].classList.contains("danger")).toBe(true);
  });
});
