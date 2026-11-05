// ResetScheduleGrid — port of components/subscription-card/
// reset-schedule-grid.tsx (#27).
//
// Lists the enabled schedules of a subscription with a live countdown and the
// manual "可用 / 已用尽" switch. Weekly and monthly countdowns carry the
// ADR-0013 urgency colour (same pure function as the usage windows will use).

import { For, type Component } from "solid-js";
import type { ResetSchedule } from "../subscriptions/types";
import {
  formatNextResetTime,
  getResetUrgencyColor,
  getScheduleTypeLabel,
  sortResetSchedules,
} from "../subscriptions/reset";
import { createNow } from "../lib/useNow";

interface ResetScheduleGridProps {
  schedules: ResetSchedule[];
  onToggle: (scheduleId: string, exhausted: boolean) => void;
}

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function scheduleLabel(schedule: ResetSchedule): string {
  switch (schedule.type) {
    case "weekly":
      return `每周${DAY_NAMES[schedule.dayOfWeek ?? 0]}`;
    case "monthly":
      return `每月${schedule.dayOfMonth}日`;
    default:
      return getScheduleTypeLabel(schedule.type);
  }
}

function urgencyColor(schedule: ResetSchedule, now: number): string | null {
  if (schedule.type !== "weekly" && schedule.type !== "monthly") return null;
  return getResetUrgencyColor(schedule.type, schedule.nextResetTime, now);
}

export const ResetScheduleGrid: Component<ResetScheduleGridProps> = (props) => {
  const now = createNow();
  const visible = () =>
    sortResetSchedules(props.schedules).filter((schedule) => schedule.enabled);

  return (
    <div class="reset-schedule-grid">
      <span class="reset-schedule-grid-title">额度重置计划</span>
      <div class="reset-schedule-grid-body">
        <For each={visible()}>
          {(schedule) => (
            <div class="reset-schedule-grid-row">
              <span class="reset-schedule-grid-type">
                {scheduleLabel(schedule)}
              </span>
              <span
                class="reset-schedule-countdown"
                style={{ color: urgencyColor(schedule, now()) ?? undefined }}
                title={schedule.nextResetTime}
              >
                {formatNextResetTime(schedule.nextResetTime, now())}
              </span>
              <button
                type="button"
                classList={{
                  "reset-schedule-exhausted": schedule.exhausted,
                }}
                onClick={() => props.onToggle(schedule.id, !schedule.exhausted)}
              >
                {schedule.exhausted ? "已用尽" : "可用"}
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
