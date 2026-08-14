"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResetSchedule,
  ResetScheduleType,
  RESET_SCHEDULE_TYPES,
} from "@/lib/types";
import { createResetSchedule } from "@/lib/reset-schedule";
import {
  formatNextResetTime,
  getScheduleTypeLabel,
  getTimezoneAbbr,
} from "@/lib/utils";
import { useNow } from "@/hooks/useNow";
import {
  extractScheduleFromOffset,
  parseDurationString,
  sortResetSchedules,
} from "@/lib/reset-schedule";
import { Plus, Trash2, Clock, Globe } from "lucide-react";

interface ResetScheduleConfigProps {
  schedules: ResetSchedule[];
  onChange: (schedules: ResetSchedule[]) => void;
}

type InputMethod = "direct" | "offset";

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function getDayOfWeekLabel(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || "";
}

export function ResetScheduleConfig({
  schedules,
  onChange,
}: ResetScheduleConfigProps) {
  // Re-render periodically so formatNextResetTime (which uses new Date()) updates
  useNow();
  const [showAddForm, setShowAddForm] = useState(false);
  const [scheduleType, setScheduleType] =
    useState<ResetScheduleType>("fiveHour");
  const [inputMethod, setInputMethod] = useState<InputMethod>("offset");

  const [offsetDuration, setOffsetDuration] = useState<string>("");
  const [nextResetTimeInput, setNextResetTimeInput] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("1");
  const [dayOfMonth, setDayOfMonth] = useState<string>("1");
  const [timeOfDay, setTimeOfDay] = useState<string>("00:00");

  const [offsetError, setOffsetError] = useState<string>("");

  const [preview, setPreview] = useState<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [currentTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  });

  const calculatePreview = useCallback(
    (
      type: ResetScheduleType,
      inputMethod: InputMethod,
      offsetDuration: string,
      dayOfWeek: string,
      dayOfMonth: string,
      timeOfDay: string
    ): string => {
      if (inputMethod !== "offset" || !offsetDuration.trim()) {
        return "";
      }

      const parsed = parseDurationString(offsetDuration);
      if (!parsed) {
        return "";
      }

      const totalMinutes =
        parsed.days * 24 * 60 + parsed.hours * 60 + parsed.minutes;
      if (totalMinutes < 1) {
        return "";
      }

      const now = new Date();
      const nextReset = new Date(now.getTime() + totalMinutes * 60 * 1000);
      const timezone = currentTimezone;

      const formatPreviewTime = (date: Date): string => {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const hour = String(date.getHours()).padStart(2, "0");
        const minute = String(date.getMinutes()).padStart(2, "0");
        const dayOfWeekName = DAY_NAMES[date.getDay()];
        return `${month}月${day}日 ${dayOfWeekName} ${hour}:${minute}`;
      };

      try {
        const nextResetInTz = timezone
          ? new Date(nextReset.toLocaleString("en-US", { timeZone: timezone }))
          : nextReset;

        const tzAbbr = getTimezoneAbbr(timezone);

        if (type === "fiveHour") {
          const days = parsed.days;
          const hours = parsed.hours;
          const minutes = parsed.minutes;

          let offsetText = "";
          if (days > 0) offsetText += `${days}天`;
          if (hours > 0) offsetText += `${hours}小时`;
          if (minutes > 0) offsetText += `${minutes}分钟`;

          return `下次重置将在 ${offsetText}后 (${formatPreviewTime(nextResetInTz)}) (${tzAbbr})`;
        } else if (type === "weekly") {
          const inferredDayOfWeek = nextResetInTz.getDay();
          const inferredTime = extractScheduleFromOffset(
            type,
            totalMinutes,
            timezone
          ).timeOfDay;

          return `将持续在 每周${DAY_NAMES[inferredDayOfWeek]} ${inferredTime} 重置 (${tzAbbr})`;
        } else if (type === "monthly") {
          const inferredDayOfMonth = nextResetInTz.getDate();
          const inferredTime = extractScheduleFromOffset(
            type,
            totalMinutes,
            timezone
          ).timeOfDay;

          return `将持续在 每月${inferredDayOfMonth}日 ${inferredTime} 重置 (${tzAbbr})`;
        }
      } catch {
        return "";
      }

      return "";
    },
    [currentTimezone]
  );

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (inputMethod === "offset" && offsetDuration.trim()) {
      debounceTimerRef.current = setTimeout(() => {
        const previewText = calculatePreview(
          scheduleType,
          inputMethod,
          offsetDuration,
          dayOfWeek,
          dayOfMonth,
          timeOfDay
        );
        setPreview(previewText);
      }, 500);
    } else {
      setPreview("");
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    scheduleType,
    inputMethod,
    offsetDuration,
    dayOfWeek,
    dayOfMonth,
    timeOfDay,
    calculatePreview,
  ]);

  const usedTypes = useMemo(
    () => new Set(schedules.map((s) => s.type)),
    [schedules]
  );

  // When opening the add form, ensure the selected type isn't already used
  useEffect(() => {
    if (showAddForm && usedTypes.has(scheduleType)) {
      const available = RESET_SCHEDULE_TYPES.find((t) => !usedTypes.has(t));
      if (available) {
        setScheduleType(available);
      }
    }
  }, [showAddForm, usedTypes, scheduleType]);

  const handleAddSchedule = () => {
    setOffsetError("");

    // Safety check: prevent duplicate types
    if (usedTypes.has(scheduleType)) {
      setOffsetError(`类型 "${getScheduleTypeLabel(scheduleType)}" 已存在`);
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      let schedule: ResetSchedule;

      if (scheduleType === "fiveHour") {
        if (inputMethod === "offset") {
          if (!offsetDuration.trim()) {
            setOffsetError("请输入持续时间");
            return;
          }

          const parsed = parseDurationString(offsetDuration);
          if (!parsed) {
            setOffsetError("格式错误，请使用如：3d 5h 44m");
            return;
          }

          const totalMinutes =
            parsed.days * 24 * 60 + parsed.hours * 60 + parsed.minutes;
          if (totalMinutes < 1) {
            setOffsetError("持续时间必须至少为 1 分钟");
            return;
          }

          const now = new Date();
          const nextReset = new Date(now.getTime() + totalMinutes * 60 * 1000);

          schedule = createResetSchedule({
            type: "fiveHour",
            enabled: true,
            timezone,
          });

          schedule.nextResetTime = nextReset.toISOString();
        } else {
          if (!nextResetTimeInput.trim()) {
            setOffsetError("请输入下次重置时间");
            return;
          }

          const nextReset = new Date(nextResetTimeInput);
          if (isNaN(nextReset.getTime())) {
            setOffsetError("无效的日期时间格式");
            return;
          }

          schedule = createResetSchedule({
            type: "fiveHour",
            enabled: true,
            timezone,
          });

          schedule.nextResetTime = nextReset.toISOString();
        }
      } else if (scheduleType === "weekly") {
        if (inputMethod === "offset") {
          if (!offsetDuration.trim()) {
            setOffsetError("请输入持续时间");
            return;
          }

          const parsed = parseDurationString(offsetDuration);
          if (!parsed) {
            setOffsetError("格式错误，请使用如：3d 5h 44m");
            return;
          }

          const totalMinutes =
            parsed.days * 24 * 60 + parsed.hours * 60 + parsed.minutes;
          if (totalMinutes < 1) {
            setOffsetError("持续时间必须至少为 1 分钟");
            return;
          }

          const extracted = extractScheduleFromOffset(
            "weekly",
            totalMinutes,
            timezone
          );

          schedule = createResetSchedule({
            type: "weekly",
            enabled: true,
            dayOfWeek: extracted.dayOfWeek!,
            timeOfDay: extracted.timeOfDay,
            timezone,
          });
        } else {
          const day = parseInt(dayOfWeek);
          schedule = createResetSchedule({
            type: "weekly",
            enabled: true,
            dayOfWeek: day,
            timeOfDay,
            timezone,
          });
        }
      } else if (scheduleType === "monthly") {
        if (inputMethod === "offset") {
          if (!offsetDuration.trim()) {
            setOffsetError("请输入持续时间");
            return;
          }

          const parsed = parseDurationString(offsetDuration);
          if (!parsed) {
            setOffsetError("格式错误，请使用如：3d 5h 44m");
            return;
          }

          const totalMinutes =
            parsed.days * 24 * 60 + parsed.hours * 60 + parsed.minutes;
          if (totalMinutes < 1) {
            setOffsetError("持续时间必须至少为 1 分钟");
            return;
          }

          const extracted = extractScheduleFromOffset(
            "monthly",
            totalMinutes,
            timezone
          );

          schedule = createResetSchedule({
            type: "monthly",
            enabled: true,
            dayOfMonth: extracted.dayOfMonth!,
            timeOfDay: extracted.timeOfDay,
            timezone,
          });
        } else {
          const day = parseInt(dayOfMonth);
          schedule = createResetSchedule({
            type: "monthly",
            enabled: true,
            dayOfMonth: day,
            timeOfDay,
            timezone,
          });
        }
      } else {
        return;
      }

      onChange([...schedules, schedule]);
      setShowAddForm(false);
      resetForm();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      setOffsetError(`创建计划失败: ${errorMessage}`);
    }
  };

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

  const handleRemoveSchedule = (scheduleId: string) => {
    onChange(schedules.filter((s) => s.id !== scheduleId));
  };

  const handleToggleSchedule = (scheduleId: string) => {
    onChange(
      schedules.map((s) =>
        s.id === scheduleId ? { ...s, enabled: !s.enabled } : s
      )
    );
  };

  const handleInputMethodChange = (newMethod: InputMethod) => {
    if (newMethod === "direct" && inputMethod === "offset") {
      const parsed = parseDurationString(offsetDuration);
      if (parsed) {
        const totalMinutes =
          parsed.days * 24 * 60 + parsed.hours * 60 + parsed.minutes;
        if (totalMinutes >= 1) {
          const timezone = currentTimezone;
          const extracted = extractScheduleFromOffset(
            scheduleType,
            totalMinutes,
            timezone
          );

          if (scheduleType === "weekly" && extracted.dayOfWeek !== undefined) {
            setDayOfWeek(String(extracted.dayOfWeek));
            setTimeOfDay(extracted.timeOfDay);
          } else if (
            scheduleType === "monthly" &&
            extracted.dayOfMonth !== undefined
          ) {
            setDayOfMonth(String(extracted.dayOfMonth));
            setTimeOfDay(extracted.timeOfDay);
          }
        }
      }
    } else if (newMethod === "offset" && inputMethod === "direct") {
      setOffsetDuration("");
      setDayOfWeek("1");
      setDayOfMonth("1");
      setTimeOfDay("00:00");
      setNextResetTimeInput("");
    }

    setInputMethod(newMethod);
    setOffsetError("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">额度重置计划</Label>
        {usedTypes.size < RESET_SCHEDULE_TYPES.length && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            添加
          </Button>
        )}
      </div>

      {schedules.length > 0 && (
        <div className="space-y-2">
          {sortResetSchedules(schedules).map((schedule) => (
            <div
              key={schedule.id}
              className="flex items-center justify-between p-2 border rounded-md"
            >
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={() => handleToggleSchedule(schedule.id)}
                  className="h-4 w-4"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {schedule.type === "fiveHour" && `每5小时`}
                      {schedule.type === "weekly" &&
                        `每${getDayOfWeekLabel(schedule.dayOfWeek ?? 0)}`}
                      {schedule.type === "monthly" &&
                        `每${schedule.dayOfMonth}日`}
                    </span>
                    {schedule.type !== "fiveHour" && schedule.timeOfDay && (
                      <span className="text-xs text-muted-foreground">
                        {schedule.timeOfDay}
                      </span>
                    )}
                    {schedule.timezone && schedule.type !== "fiveHour" && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {getTimezoneAbbr(schedule.timezone)}
                      </span>
                    )}
                  </div>
                  {schedule.nextResetTime && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      下次重置: {formatNextResetTime(schedule.nextResetTime)}
                    </div>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveSchedule(schedule.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAddForm && (
        <div className="border p-3 rounded-md space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">类型</Label>
              <Select
                value={scheduleType}
                onValueChange={(value) => {
                  setScheduleType(value as ResetScheduleType);
                  setOffsetError("");
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESET_SCHEDULE_TYPES.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      disabled={usedTypes.has(type)}
                    >
                      {getScheduleTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">输入方式</Label>
              <Select
                value={inputMethod}
                onValueChange={(value) => {
                  handleInputMethodChange(value as InputMethod);
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="offset">从现在起</SelectItem>
                  <SelectItem value="direct">直接输入</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {scheduleType === "weekly" && inputMethod === "direct" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">星期</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {getDayOfWeekLabel(day)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">时间</Label>
                <Input
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          )}

          {scheduleType === "monthly" && inputMethod === "direct" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">日期</Label>
                <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {day}日
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">时间</Label>
                <Input
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          )}

          {inputMethod === "offset" && (
            <div className="space-y-2">
              <Label className="text-xs">持续时间</Label>
              <Input
                type="text"
                placeholder="如：3d 5h 44m"
                value={offsetDuration}
                onChange={(e) => {
                  setOffsetDuration(e.target.value);
                  setOffsetError("");
                }}
                className="h-8"
              />
              <div className="text-xs text-muted-foreground">
                支持格式：d(天) h(小时) m(分钟)，如：3d 5h 44m（至少 1m）
              </div>
              {preview && (
                <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded border border-blue-200">
                  {preview}
                </div>
              )}
            </div>
          )}

          {inputMethod === "direct" && scheduleType === "fiveHour" && (
            <div className="space-y-2">
              <Label className="text-xs">下次重置时间</Label>
              <Input
                type="datetime-local"
                value={nextResetTimeInput}
                onChange={(e) => {
                  setNextResetTimeInput(e.target.value);
                  setOffsetError("");
                }}
                className="h-8"
              />
            </div>
          )}

          {offsetError && (
            <div className="text-xs text-red-500">{offsetError}</div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAddForm(false);
                resetForm();
              }}
            >
              取消
            </Button>
            <Button type="button" size="sm" onClick={handleAddSchedule}>
              确定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
