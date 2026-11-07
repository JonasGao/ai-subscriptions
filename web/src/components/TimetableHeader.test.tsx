// Structure contract for the shared 30-day axis: the header's tick scale is
// the coordinate system every row's rails must land on. Ticks are pinned at
// their exact day offsets (every 5 days across 30), so tick[0] sits at 0%,
// tick[6] at 100% — the geometry the layout phase fixed in CSS.

import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { TimetableHeader } from "./TimetableHeader";

const NOW = new Date("2026-11-07T08:00:00").getTime();

describe("TimetableHeader", () => {
  afterEach(cleanup);

  it("renders the seven columns as a table row", () => {
    render(() => <TimetableHeader now={NOW} />);

    for (const name of ["序号", "服务", "金额", "账单周期", "状态", "操作"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText("下次重置 · 四轨 30 天共轴")).toBeTruthy();
    expect(
      document.querySelector(".timetable-header")!.getAttribute("role")
    ).toBe("row");
    expect(document.querySelectorAll('[role="columnheader"]').length).toBe(7);
  });

  it("pins the seven date ticks at their exact day offsets", () => {
    render(() => <TimetableHeader now={NOW} />);

    const ticks = Array.from(
      document.querySelectorAll<HTMLElement>(".timetable-tick")
    );
    expect(ticks).toHaveLength(7);
    expect(ticks[0].className).toContain("first");
    expect(ticks[6].className).toContain("last");
    // jsdom normalises "0.000%" to "0%", so compare the numeric offsets.
    expect(parseFloat(ticks[0].style.left)).toBe(0);
    expect(parseFloat(ticks[1].style.left)).toBeCloseTo(100 / 6, 2);
    expect(parseFloat(ticks[3].style.left)).toBe(50);
    expect(parseFloat(ticks[6].style.left)).toBe(100);
    expect(ticks[0].textContent).toBe("11-07");
    expect(ticks[6].textContent).toBe("12-07");
  });

  it("names the four track colours once, in the legend", () => {
    render(() => <TimetableHeader now={NOW} />);

    expect(screen.getByText("账单")).toBeTruthy();
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.getByText("周")).toBeTruthy();
    expect(screen.getByText("月")).toBeTruthy();
    expect(document.querySelectorAll(".tt-chip")).toHaveLength(4);
  });
});
