import { For, type Component } from "solid-js";

/**
 * The timetable's column header: seven fixed columns over a shared 30-day
 * axis. Date ticks are real calendar dates from the current day, positioned
 * at their exact day offset (every 5 days across 30) so a notch in any row's
 * rail can be read against them — header and rows share one grid template
 * and one coordinate system (tick[0] sits over rail day 0 at every width).
 * This is a table header, not navigation; the legend chips only name the
 * four track colours the axis cells render, top to bottom.
 */

const DAY_MS = 86_400_000;

interface Tick {
  label: string;
  left: string;
  edge: "first" | "last" | "middle";
}

function ticks(now: number): Tick[] {
  const start = new Date(now);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start.getTime() + index * 5 * DAY_MS);
    return {
      label: `${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      left: `${((index / 6) * 100).toFixed(3)}%`,
      edge: index === 0 ? "first" : index === 6 ? "last" : "middle",
    };
  });
}

const LEGEND: Array<{ label: string; fill: string }> = [
  { label: "账单", fill: "timetable-bill" },
  { label: "5h", fill: "timetable-fiveHour" },
  { label: "周", fill: "timetable-weekly" },
  { label: "月", fill: "timetable-monthly" },
];

interface TimetableHeaderProps {
  now: number;
}

export const TimetableHeader: Component<TimetableHeaderProps> = (props) => (
  <div class="timetable-header" role="row">
    <span class="timetable-hcell timetable-h-num" role="columnheader">
      序号
    </span>
    <span class="timetable-hcell" role="columnheader">
      服务
    </span>
    <span class="timetable-hcell timetable-h-amt" role="columnheader">
      金额
    </span>
    <span class="timetable-hcell" role="columnheader">
      账单周期
    </span>
    <span class="timetable-hcell" role="columnheader">
      状态
    </span>
    <div class="timetable-hcell timetable-h-axis" role="columnheader">
      <span class="timetable-hlabel">下次重置 · 四轨 30 天共轴</span>
      <span class="timetable-legend">
        <For each={LEGEND}>
          {(item) => (
            <span class="timetable-legend-item">
              <span class={`tt-chip ${item.fill}`} aria-hidden="true" />
              {item.label}
            </span>
          )}
        </For>
      </span>
      <div class="timetable-ticks" aria-hidden="true">
        <For each={ticks(props.now)}>
          {(tick) => (
            <span
              class={`timetable-tick ${tick.edge}`}
              style={{ left: tick.left }}
            >
              {tick.label}
            </span>
          )}
        </For>
      </div>
    </div>
    <span class="timetable-hcell timetable-h-actions" role="columnheader">
      操作
    </span>
  </div>
);
