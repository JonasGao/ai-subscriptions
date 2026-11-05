import { For, type Component } from "solid-js";

/**
 * The timetable's column header: seven fixed columns over a shared 30-day axis.
 * Date ticks are real calendar dates from the current day, not a static image.
 * This is a table header, not navigation and not a chart legend.
 */

const DAY_MS = 86_400_000;

function ticks(now: number): string[] {
  const start = new Date(now);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start.getTime() + index * 5 * DAY_MS);
    return `${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  });
}

interface TimetableHeaderProps {
  now: number;
}

export const TimetableHeader: Component<TimetableHeaderProps> = (props) => (
  <div class="timetable-header" role="row">
    <span class="timetable-hcell timetable-h-num">序号</span>
    <span class="timetable-hcell">服务</span>
    <span class="timetable-hcell timetable-h-amt">金额</span>
    <span class="timetable-hcell">账单周期</span>
    <span class="timetable-hcell">状态</span>
    <div class="timetable-hcell timetable-h-axis">
      <span class="timetable-hlabel">下次重置 / 周期视图</span>
      <div class="timetable-ticks" aria-hidden="true">
        <For each={ticks(props.now)}>{(tick) => <span>{tick}</span>}</For>
      </div>
    </div>
    <span class="timetable-hcell timetable-h-actions">操作</span>
  </div>
);
