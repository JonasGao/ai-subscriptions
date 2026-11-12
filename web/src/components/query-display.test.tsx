// The usage window rendering the old stack had: a percentage label and a
// threshold-colored progress bar, both hidden when the ratio cannot be
// computed (missing/zero/negative limit). These cases lock the semantics that
// the previous private `usagePercent` helper silently changed.

import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import {
  BalanceInfoRows,
  QuotaProgress,
  UsageWarnings,
  UsageWindows,
} from "./query-display";
import type { BalanceInfo, UsageWindow } from "../subscriptions/types";

function makeWindow(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return {
    limit: "100",
    used: "50",
    remaining: "50",
    resetTime: null,
    ...overrides,
  };
}

describe("QuotaProgress (one-time额度 row for the detail band)", () => {
  afterEach(cleanup);

  it("renders a labeled usage row and a progressbar with the remaining share", () => {
    const result = render(() => <QuotaProgress current={25} total={100} />);

    expect(result.getByText("额度余额")).toBeTruthy();
    expect(result.getByText("25 / 100")).toBeTruthy();
    expect(result.container.querySelector(".usage-percent")!.textContent).toBe(
      "25.0%"
    );
    const bar = result.getByRole("progressbar", { name: "额度余额" });
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    const fill = bar.querySelector(".usage-progress-fill") as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("uses the filled balance as the current value without any query", () => {
    const result = render(() => <QuotaProgress current={180} total={200} />);

    expect(result.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "90"
    );
  });

  it("clamps a current value above the total to 100%", () => {
    const result = render(() => <QuotaProgress current={260} total={200} />);

    expect(result.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100"
    );
    expect(
      (result.container.querySelector(".usage-progress-fill") as HTMLElement)
        .style.width
    ).toBe("100%");
  });

  it("tiers by depletion: low remaining is danger, full is normal", () => {
    const low = render(() => <QuotaProgress current={5} total={100} />);
    expect(
      low.container
        .querySelector(".usage-progress-fill")!
        .classList.contains("danger")
    ).toBe(true);
    cleanup();

    const warning = render(() => <QuotaProgress current={25} total={100} />);
    expect(
      warning.container
        .querySelector(".usage-progress-fill")!
        .classList.contains("warning")
    ).toBe(true);
    cleanup();

    const normal = render(() => <QuotaProgress current={100} total={100} />);
    expect(
      normal.container
        .querySelector(".usage-progress-fill")!
        .classList.contains("normal")
    ).toBe(true);
  });

  it("hides the whole row when there is no total or no current amount", () => {
    for (const props of [
      { current: null, total: 100 },
      { current: 50, total: 0 },
      { current: 50, total: -1 },
    ]) {
      const result = render(() => <QuotaProgress {...props} />);
      expect(result.queryByRole("progressbar")).toBeNull();
      expect(result.container.querySelector(".usage-row")).toBeNull();
      cleanup();
    }
  });
});

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

function makeBalanceInfo(overrides: Partial<BalanceInfo> = {}): BalanceInfo {
  return {
    currency: "USD",
    available: "12.35",
    total: null,
    toppedUp: null,
    granted: null,
    used: null,
    frozen: null,
    ...overrides,
  };
}

// A relay plan-name string once landed in BalanceInfo.total. formatBalance
// coerced it to 0, so 总额度 showed "¥0.00". Non-numeric totals are now hidden.
describe("BalanceInfoRows", () => {
  afterEach(cleanup);

  it("renders a numeric total as a formatted amount", () => {
    const result = render(() => (
      <BalanceInfoRows
        balance={{
          provider: "morphapi",
          isAvailable: true,
          balanceInfos: [makeBalanceInfo({ total: "12.35" })],
        }}
      />
    ));
    expect(result.getByText("总额度")).toBeTruthy();
    expect(result.getByText("$12.35")).toBeTruthy();
  });

  it("hides 总额度 when total is a non-numeric label instead of showing 0", () => {
    const result = render(() => (
      <BalanceInfoRows
        balance={{
          provider: "morphapi",
          isAvailable: true,
          balanceInfos: [makeBalanceInfo({ total: "订阅" })],
        }}
      />
    ));
    expect(result.queryByText("总额度")).toBeNull();
    expect(result.container.textContent).not.toContain("$0.00");
  });
});

// Relay providers (FastAI) surface plan name, currency and cumulative spend
// through UsageResult.warnings. The field was previously declared but never
// rendered, so this pins its visibility.
describe("UsageWarnings", () => {
  afterEach(cleanup);

  it("renders each warning as a list item", () => {
    const result = render(() => (
      <UsageWarnings warnings={["钱包余额 · USD", "累计消耗: 10.02 USD"]} />
    ));

    const items = result.container.querySelectorAll(".usage-warning");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("钱包余额 · USD");
    expect(items[1].textContent).toBe("累计消耗: 10.02 USD");
  });

  it("renders nothing when there are no warnings", () => {
    for (const warnings of [undefined, [] as string[]]) {
      const result = render(() => <UsageWarnings warnings={warnings} />);
      expect(result.container.querySelector(".usage-warnings")).toBeNull();
    }
  });
});
