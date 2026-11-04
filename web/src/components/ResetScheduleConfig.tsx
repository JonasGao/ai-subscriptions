// ResetScheduleConfig — port of components/ResetScheduleConfig.tsx (#27).
//
// Two creation methods (ADR-0003):
//   - "从现在起" (offset): the user types a duration like "3d 5h 44m"; the
//     component infers dayOfWeek/dayOfMonth/timeOfDay from the resulting
//     instant and previews the inferred pattern after a 500 ms debounce.
//   - "直接输入" (direct): the user picks the weekday/day and time explicitly.
// At most one schedule per type is allowed; used types are disabled.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import type { ResetSchedule, ResetScheduleType } from "../subscriptions/types";
import {
  RESET_SCHEDULE_TYPES,
  createResetSchedule,
  durationMinutes,
  extractScheduleFromOffset,
  formatNextResetTime,
  getScheduleTypeLabel,
  getTimezoneAbbr,
  parseDurationString,
  sortResetSchedules,
} from "../subscriptions/reset";
import { createNow } from "../lib/useNow";

interface ResetScheduleConfigProps {
  schedules: ResetSchedule[];
  onChange: (schedules: ResetSchedule[]) => void;
  /** Overrides the detected timezone (tests pass "UTC"). */
  timezone?: string;
}

type InputMethod = "offset" | "direct";

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function getDayOfWeekLabel(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || "";
}

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const ResetScheduleConfig: Component<ResetScheduleConfigProps> = (
  props
) => {
  const now = createNow();
  const timezone = () => props.timezone ?? detectedTimezone();

  const [showAddForm, setShowAddForm] = createSignal(false);
  const [scheduleType, setScheduleType] =
    createSignal<ResetScheduleType>("fiveHour");
  const [inputMethod, setInputMethod] = createSignal<InputMethod>("offset");
  const [offsetDuration, setOffsetDuration] = createSignal("");
  const [nextResetTimeInput, setNextResetTimeInput] = createSignal("");
  const [dayOfWeek, setDayOfWeek] = createSignal("1");
  const [dayOfMonth, setDayOfMonth] = createSignal("1");
  const [timeOfDay, setTimeOfDay] = createSignal("00:00");
  const [offsetError, setOffsetError] = createSignal("");
  const [preview, setPreview] = createSignal("");

  const usedTypes = createMemo(
    () => new Set(props.schedules.map((schedule) => schedule.type))
  );

  const availableTypes = createMemo(() =>
    RESET_SCHEDULE_TYPES.filter((type) => !usedTypes().has(type))
  );

  const resetForm = () => {
    setScheduleType("fiveHour");
    setInputMethod("offset");
    setOffsetDuration("");
    setNextResetTimeInput("");
    setDayOfWeek("1");
    setDayOfMonth("1");
    setTimeOfDay("00:00");
    setOffsetError("");
    setPreview("");
  };

  const openAddForm = () => {
    if (usedTypes().has(scheduleType())) {
      const [available] = availableTypes();
      if (available) setScheduleType(available);
    }
    setShowAddForm(true);
  };

  const parsedOffset = () => parseDurationString(offsetDuration());
  const offsetMinutes = () => {
    const parsed = parsedOffset();
    return parsed ? durationMinutes(parsed) : 0;
  };

  const formatPreviewTime = (date: Date): string => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}月${day}日 ${DAY_NAMES[date.getDay()]} ${hour}:${minute}`;
  };

  /** Preview text for the offset form (ADR-0003 wording). */
  const calculatePreview = (
    type: ResetScheduleType,
    duration: string
  ): string => {
    if (!duration.trim()) return "";
    const parsed = parseDurationString(duration);
    if (!parsed) return "";
    const minutes = durationMinutes(parsed);
    if (minutes < 1) return "";

    const current = new Date(now());
    const nextReset = new Date(current.getTime() + minutes * 60_000);
    const zone = timezone();
    const tzAbbr = getTimezoneAbbr(zone);
    const wallClock = new Date(
      nextReset.toLocaleString("en-US", { timeZone: zone })
    );
    const inferredTime = extractScheduleFromOffset(
      type,
      minutes,
      zone,
      current
    ).timeOfDay;

    if (type === "fiveHour") {
      const offsetText = formatDurationWords(
        parsed.days,
        parsed.hours,
        parsed.minutes
      );
      return `下次重置将在 ${offsetText}后 (${formatPreviewTime(
        wallClock
      )}) (${tzAbbr})`;
    }
    if (type === "weekly") {
      return `将持续在 每周${DAY_NAMES[wallClock.getDay()]} ${inferredTime} 重置 (${tzAbbr})`;
    }
    return `将持续在 每月${wallClock.getDate()}日 ${inferredTime} 重置 (${tzAbbr})`;
  };

  // Debounced preview: 500 ms after typing stops (ADR-0003).
  createEffect(() => {
    const type = scheduleType();
    const method = inputMethod();
    const duration = offsetDuration();
    if (method !== "offset" || !duration.trim()) {
      setPreview("");
      return;
    }
    const timer = setTimeout(() => {
      setPreview(calculatePreview(type, duration));
    }, 500);
    onCleanup(() => clearTimeout(timer));
  });

  const handleAddSchedule = () => {
    setOffsetError("");
    if (usedTypes().has(scheduleType())) {
      setOffsetError(`类型 "${getScheduleTypeLabel(scheduleType())}" 已存在`);
      return;
    }

    const current = new Date(now());
    const type = scheduleType();
    const zone = timezone();
    let schedule: ResetSchedule;

    try {
      if (inputMethod() === "offset") {
        if (!offsetDuration().trim()) {
          setOffsetError("请输入持续时间");
          return;
        }
        const parsed = parsedOffset();
        if (!parsed) {
          setOffsetError("格式错误，请使用如：3d 5h 44m");
          return;
        }
        const minutes = durationMinutes(parsed);
        if (minutes < 1) {
          setOffsetError("持续时间必须至少为 1 分钟");
          return;
        }

        if (type === "fiveHour") {
          const nextReset = new Date(current.getTime() + minutes * 60_000);
          schedule = createResetSchedule(
            { type, timezone: zone, nextResetTime: nextReset.toISOString() },
            current
          );
        } else {
          const inferred = extractScheduleFromOffset(
            type,
            minutes,
            zone,
            current
          );
          schedule = createResetSchedule(
            {
              type,
              dayOfWeek: inferred.dayOfWeek,
              dayOfMonth: inferred.dayOfMonth,
              timeOfDay: inferred.timeOfDay,
              timezone: zone,
            },
            current
          );
        }
      } else if (type === "fiveHour") {
        if (!nextResetTimeInput().trim()) {
          setOffsetError("请输入下次重置时间");
          return;
        }
        const nextReset = new Date(nextResetTimeInput());
        if (Number.isNaN(nextReset.getTime())) {
          setOffsetError("无效的日期时间格式");
          return;
        }
        schedule = createResetSchedule(
          { type, timezone: zone, nextResetTime: nextReset.toISOString() },
          current
        );
      } else {
        schedule = createResetSchedule(
          {
            type,
            dayOfWeek:
              type === "weekly" ? parseInt(dayOfWeek(), 10) : undefined,
            dayOfMonth:
              type === "monthly" ? parseInt(dayOfMonth(), 10) : undefined,
            timeOfDay: timeOfDay(),
            timezone: zone,
          },
          current
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setOffsetError(`创建计划失败: ${message}`);
      return;
    }

    props.onChange([...props.schedules, schedule]);
    setShowAddForm(false);
    resetForm();
  };

  /** Offset → direct switch pre-fills the inferred day/time (ADR-0003). */
  const handleInputMethodChange = (method: InputMethod) => {
    if (method === "direct" && inputMethod() === "offset") {
      const minutes = offsetMinutes();
      if (minutes >= 1) {
        const inferred = extractScheduleFromOffset(
          scheduleType(),
          minutes,
          timezone(),
          new Date(now())
        );
        if (scheduleType() === "weekly" && inferred.dayOfWeek !== undefined) {
          setDayOfWeek(String(inferred.dayOfWeek));
          setTimeOfDay(inferred.timeOfDay);
        } else if (
          scheduleType() === "monthly" &&
          inferred.dayOfMonth !== undefined
        ) {
          setDayOfMonth(String(inferred.dayOfMonth));
          setTimeOfDay(inferred.timeOfDay);
        }
      }
    } else if (method === "offset" && inputMethod() === "direct") {
      setOffsetDuration("");
      setDayOfWeek("1");
      setDayOfMonth("1");
      setTimeOfDay("00:00");
      setNextResetTimeInput("");
    }
    setInputMethod(method);
    setOffsetError("");
  };

  const handleRemoveSchedule = (scheduleId: string) => {
    props.onChange(
      props.schedules.filter((schedule) => schedule.id !== scheduleId)
    );
  };

  const handleToggleSchedule = (scheduleId: string) => {
    props.onChange(
      props.schedules.map((schedule) =>
        schedule.id === scheduleId
          ? { ...schedule, enabled: !schedule.enabled }
          : schedule
      )
    );
  };

  return (
    <div class="reset-schedule-config">
      <div class="reset-schedule-header">
        <span class="reset-schedule-title">额度重置计划</span>
        <Show when={availableTypes().length > 0}>
          <button type="button" class="ghost" onClick={openAddForm}>
            添加计划
          </button>
        </Show>
      </div>

      <Show when={props.schedules.length > 0}>
        <ul class="reset-schedule-list">
          <For each={sortResetSchedules(props.schedules)}>
            {(schedule) => (
              <li class="reset-schedule-row">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  aria-label={`启用 ${getScheduleTypeLabel(schedule.type)}`}
                  onChange={() => handleToggleSchedule(schedule.id)}
                />
                <div class="reset-schedule-body">
                  <div class="reset-schedule-meta">
                    <span class="reset-schedule-type">
                      {schedule.type === "fiveHour" && "每5小时"}
                      {schedule.type === "weekly" &&
                        `每${getDayOfWeekLabel(schedule.dayOfWeek ?? 0)}`}
                      {schedule.type === "monthly" &&
                        `每${schedule.dayOfMonth}日`}
                    </span>
                    <Show
                      when={schedule.type !== "fiveHour" && schedule.timeOfDay}
                    >
                      <span class="reset-schedule-time">
                        {schedule.timeOfDay}
                      </span>
                    </Show>
                    <Show
                      when={schedule.timezone && schedule.type !== "fiveHour"}
                    >
                      <span class="reset-schedule-timezone">
                        {getTimezoneAbbr(schedule.timezone)}
                      </span>
                    </Show>
                  </div>
                  <div class="reset-schedule-countdown">
                    下次重置:{" "}
                    {formatNextResetTime(schedule.nextResetTime, now())}
                  </div>
                </div>
                <button
                  type="button"
                  class="ghost"
                  aria-label="删除计划"
                  onClick={() => handleRemoveSchedule(schedule.id)}
                >
                  删除
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={showAddForm()}>
        <div class="reset-schedule-form">
          <div class="reset-schedule-form-grid">
            <label for="schedule-type">
              <span>类型</span>
              <select
                id="schedule-type"
                value={scheduleType()}
                onChange={(event) => {
                  setScheduleType(
                    event.currentTarget.value as ResetScheduleType
                  );
                  setOffsetError("");
                }}
              >
                <For each={RESET_SCHEDULE_TYPES}>
                  {(type) => (
                    <option value={type} disabled={usedTypes().has(type)}>
                      {getScheduleTypeLabel(type)}
                    </option>
                  )}
                </For>
              </select>
            </label>

            <label for="schedule-input-method">
              <span>输入方式</span>
              <select
                id="schedule-input-method"
                value={inputMethod()}
                onChange={(event) =>
                  handleInputMethodChange(
                    event.currentTarget.value as InputMethod
                  )
                }
              >
                <option value="offset">从现在起</option>
                <option value="direct">直接输入</option>
              </select>
            </label>
          </div>

          <Show
            when={scheduleType() === "weekly" && inputMethod() === "direct"}
          >
            <div class="reset-schedule-form-grid">
              <label for="schedule-day-of-week">
                <span>星期</span>
                <select
                  id="schedule-day-of-week"
                  value={dayOfWeek()}
                  onChange={(event) => setDayOfWeek(event.currentTarget.value)}
                >
                  <For each={[0, 1, 2, 3, 4, 5, 6]}>
                    {(day) => (
                      <option value={String(day)}>
                        {getDayOfWeekLabel(day)}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label for="schedule-time">
                <span>时间</span>
                <input
                  id="schedule-time"
                  type="time"
                  value={timeOfDay()}
                  onInput={(event) => setTimeOfDay(event.currentTarget.value)}
                />
              </label>
            </div>
          </Show>

          <Show
            when={scheduleType() === "monthly" && inputMethod() === "direct"}
          >
            <div class="reset-schedule-form-grid">
              <label for="schedule-day-of-month">
                <span>日期</span>
                <select
                  id="schedule-day-of-month"
                  value={dayOfMonth()}
                  onChange={(event) => setDayOfMonth(event.currentTarget.value)}
                >
                  <For
                    each={Array.from({ length: 31 }, (_, index) => index + 1)}
                  >
                    {(day) => <option value={String(day)}>{day}日</option>}
                  </For>
                </select>
              </label>
              <label for="schedule-time">
                <span>时间</span>
                <input
                  id="schedule-time"
                  type="time"
                  value={timeOfDay()}
                  onInput={(event) => setTimeOfDay(event.currentTarget.value)}
                />
              </label>
            </div>
          </Show>

          <Show when={inputMethod() === "offset"}>
            <label for="schedule-offset">
              <span>持续时间</span>
              <input
                id="schedule-offset"
                type="text"
                placeholder="如：3d 5h 44m"
                value={offsetDuration()}
                onInput={(event) => {
                  setOffsetDuration(event.currentTarget.value);
                  setOffsetError("");
                }}
              />
            </label>
            <small class="reset-schedule-hint">
              支持格式：d(天) h(小时) m(分钟)，如：3d 5h 44m（至少 1m）
            </small>
            <Show when={preview()}>
              <div class="reset-schedule-preview">{preview()}</div>
            </Show>
          </Show>

          <Show
            when={inputMethod() === "direct" && scheduleType() === "fiveHour"}
          >
            <label for="schedule-next-reset">
              <span>下次重置时间</span>
              <input
                id="schedule-next-reset"
                type="datetime-local"
                value={nextResetTimeInput()}
                onInput={(event) => {
                  setNextResetTimeInput(event.currentTarget.value);
                  setOffsetError("");
                }}
              />
            </label>
          </Show>

          <Show when={offsetError()}>
            <p class="reset-schedule-error" role="alert">
              {offsetError()}
            </p>
          </Show>

          <div class="form-actions">
            <button
              type="button"
              class="ghost"
              onClick={() => {
                setShowAddForm(false);
                resetForm();
              }}
            >
              取消
            </button>
            <button type="button" onClick={handleAddSchedule}>
              确定
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

/** "3天5小时44分钟" — the offset wording of the five-hour preview. */
function formatDurationWords(
  days: number,
  hours: number,
  minutes: number
): string {
  let text = "";
  if (days > 0) text += `${days}天`;
  if (hours > 0) text += `${hours}小时`;
  if (minutes > 0) text += `${minutes}分钟`;
  return text;
}
