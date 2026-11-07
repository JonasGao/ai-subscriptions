import { For, Show, type Component } from "solid-js";
import type { ResetSchedule, ResetScheduleType } from "../subscriptions/types";
import { getResetUrgencyColor } from "../subscriptions/reset";

/**
 * Timetable axis — the one signature move of the replacement visual world.
 *
 * Four tracks share a single 30-day axis. Each fill encodes the elapsed
 * proportion of that cycle, computed from the subscription's real data:
 *   - billing: 30-day window ending at renewalDate
 *   - fiveHour / weekly / monthly: each enabled schedule's own period ending
 *     at its nextResetTime
 * The rails span the full cell width, so they sit under the header's date
 * ticks on the same coordinate system. Track names live once, in the header
 * legend; the aria-label carries the per-track data for non-visual reads.
 * It is a chart, not navigation: no click handlers, no links, no controls.
 * Empty data produces an empty track, never invented numbers.
 */

const AXIS_MS = 30 * 24 * 60 * 60 * 1000;

const PERIOD_MS: Record<ResetScheduleType, number> = {
  fiveHour: 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const TRACKS: Array<{
  key: string;
  label: string;
  spoken: string;
  type: ResetScheduleType | null;
}> = [
  { key: "bill", label: "账单", spoken: "账单", type: null },
  { key: "fiveHour", label: "5h", spoken: "5 小时", type: "fiveHour" },
  { key: "weekly", label: "周", spoken: "周", type: "weekly" },
  { key: "monthly", label: "月", spoken: "月", type: "monthly" },
];

/** Elapsed share (0..1) of one cycle, clamped; null when the data is absent. */
function elapsedShare(
  periodMs: number,
  endsAt: string | null | undefined,
  now: number
): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const elapsed = periodMs - (end - now);
  if (!Number.isFinite(elapsed)) return null;
  return Math.max(0, Math.min(1, elapsed / periodMs));
}

/** Where the cycle ends on the shared 30-day axis (0..1); null when unknown. */
function axisPosition(
  endsAt: string | null | undefined,
  now: number
): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.min(1, (end - now) / AXIS_MS));
}

/** A rail's hover title: the track name plus its date, when known. */
function railTitle(label: string, endsAt: string | null | undefined): string {
  return endsAt ? `${label} ${endsAt.slice(0, 10)}` : label;
}

interface TimetableAxisProps {
  renewalDate?: string;
  resetSchedules?: ResetSchedule[];
  now: number;
  oneTime?: boolean;
}

export const TimetableAxis: Component<TimetableAxisProps> = (props) => {
  const schedules = () =>
    (props.resetSchedules ?? []).filter((schedule) => schedule.enabled);

  /** Nearest future cycle end drives the single terminal readout. */
  const nextEvent = () => {
    const candidates: number[] = [];
    const push = (value: string | null | undefined) => {
      if (!value) return;
      const ms = new Date(value).getTime();
      if (Number.isFinite(ms) && ms > props.now) candidates.push(ms);
    };
    push(props.renewalDate);
    for (const schedule of schedules()) push(schedule.nextResetTime);
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates));
  };

  const remaining = () => {
    const event = nextEvent();
    if (!event) return "";
    const ms = event.getTime() - props.now;
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const stamp = `${event.getFullYear()}-${String(event.getMonth() + 1).padStart(2, "0")}-${String(event.getDate()).padStart(2, "0")} ${String(event.getHours()).padStart(2, "0")}:${String(event.getMinutes()).padStart(2, "0")}`;
    return `${stamp} · 剩余 ${days > 0 ? `${days}天` : ""}${hours}时${minutes}分`;
  };

  const urgency = () => {
    const event = nextEvent();
    const schedule = schedules().find(
      (item) =>
        item.type !== "fiveHour" && item.nextResetTime === event?.toISOString()
    );
    if (!schedule || schedule.type === "fiveHour") return undefined;
    return (
      getResetUrgencyColor(schedule.type, schedule.nextResetTime, props.now) ??
      undefined
    );
  };

  /** The rails are an image; one label speaks every track's real data. */
  const spokenSummary = () =>
    TRACKS.map((track) => {
      const endsAt =
        track.type === null
          ? props.renewalDate
          : schedules().find((schedule) => schedule.type === track.type)
              ?.nextResetTime;
      return endsAt ? `${track.spoken} ${endsAt.slice(0, 10)}` : null;
    })
      .filter(Boolean)
      .join("；");

  return (
    <div
      class="timetable-axis"
      role="img"
      aria-label={`四轨 30 天共轴：${spokenSummary() || "暂无班次"}`}
    >
      <Show
        when={!props.oneTime}
        fallback={<p class="timetable-axis-empty">一次性订阅 · 无重置班次</p>}
      >
        <div class="timetable-tracks">
          <For each={TRACKS}>
            {(track) => {
              const endsAt = () =>
                track.type === null
                  ? props.renewalDate
                  : schedules().find((schedule) => schedule.type === track.type)
                      ?.nextResetTime;
              const share = () =>
                track.type === null
                  ? elapsedShare(AXIS_MS, props.renewalDate, props.now)
                  : elapsedShare(PERIOD_MS[track.type], endsAt(), props.now);
              const marker = () => axisPosition(endsAt(), props.now);
              return (
                <div class="timetable-row">
                  <div
                    class="timetable-rail"
                    title={railTitle(track.label, endsAt())}
                  >
                    <Show when={share() !== null}>
                      <div
                        class={`timetable-fill timetable-${track.key}`}
                        style={{ width: `${(share()! * 100).toFixed(1)}%` }}
                      />
                    </Show>
                    <Show when={marker() !== null}>
                      <span
                        class="timetable-notch"
                        style={{ left: `${(marker()! * 100).toFixed(1)}%` }}
                        title={endsAt() ?? undefined}
                      />
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
        <p class="timetable-when" style={{ color: urgency() }}>
          {remaining() || "暂无续费或重置时间"}
        </p>
      </Show>
    </div>
  );
};
