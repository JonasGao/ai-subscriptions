"use client";

import { useState } from "react";
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
import { ResetSchedule, ResetScheduleType } from "@/lib/types";
import { createResetSchedule } from "@/lib/reset-schedule";
import { formatNextResetTime, getScheduleTypeLabel } from "@/lib/utils";
import { Plus, Trash2, Clock, Globe } from "lucide-react";

interface ResetScheduleConfigProps {
  schedules: ResetSchedule[];
  onChange: (schedules: ResetSchedule[]) => void;
}

type InputMethod = "direct" | "offset";

function getDayOfWeekLabel(dayOfWeek: number): string {
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return days[dayOfWeek] || "";
}

export function ResetScheduleConfig({
  schedules,
  onChange,
}: ResetScheduleConfigProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [scheduleType, setScheduleType] = useState<ResetScheduleType>("hourly");
  const [inputMethod, setInputMethod] = useState<InputMethod>("offset");

  const [intervalHours, setIntervalHours] = useState<string>("1");
  const [offsetDuration, setOffsetDuration] = useState<string>("");
  const [nextResetTimeInput, setNextResetTimeInput] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("1");
  const [dayOfMonth, setDayOfMonth] = useState<string>("1");
  const [timeOfDay, setTimeOfDay] = useState<string>("00:00");

  const [offsetError, setOffsetError] = useState<string>("");
  const [intervalError, setIntervalError] = useState<string>("");

  const [currentTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  });

  const getTimezoneAbbr = (timezone?: string): string => {
    if (!timezone) return "";
    const tzMap: Record<string, string> = {
      "Asia/Shanghai": "上海时间",
      "Asia/Hong_Kong": "香港时间",
      "Asia/Tokyo": "东京时间",
      "America/New_York": "纽约时间",
      "America/Los_Angeles": "洛杉矶时间",
      "Europe/London": "伦敦时间",
      UTC: "UTC",
    };
    return tzMap[timezone] || timezone.split("/").pop() || timezone;
  };

  const parseDurationString = (
    duration: string
  ): { days: number; hours: number; minutes: number } | null => {
    const trimmed = duration.replace(/\s+/g, "").toLowerCase();

    const daysMatch = trimmed.match(/(\d+)d/);
    const hoursMatch = trimmed.match(/(\d+)h/);
    const minutesMatch = trimmed.match(/(\d+)m/);

    const days = daysMatch ? parseInt(daysMatch[1]) : 0;
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;

    if (days === 0 && hours === 0 && minutes === 0) {
      return null;
    }

    if (days < 0 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return { days, hours, minutes };
  };

  const handleAddSchedule = () => {
    setOffsetError("");
    setIntervalError("");

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      let schedule: ResetSchedule;

      if (scheduleType === "hourly") {
        const interval = parseInt(intervalHours);
        if (isNaN(interval) || interval < 1) {
          setIntervalError("间隔必须至少为 1 小时");
          return;
        }

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
            type: "hourly",
            enabled: true,
            intervalHours: interval,
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
            type: "hourly",
            enabled: true,
            intervalHours: interval,
            timezone,
          });

          schedule.nextResetTime = nextReset.toISOString();
        }
      } else if (scheduleType === "weekly") {
        const day = parseInt(dayOfWeek);

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
            type: "weekly",
            enabled: true,
            dayOfWeek: day,
            timeOfDay,
            timezone,
          });

          schedule.nextResetTime = nextReset.toISOString();
        } else {
          schedule = createResetSchedule({
            type: "weekly",
            enabled: true,
            dayOfWeek: day,
            timeOfDay,
            timezone,
          });
        }
      } else if (scheduleType === "monthly") {
        const day = parseInt(dayOfMonth);

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
            type: "monthly",
            enabled: true,
            dayOfMonth: day,
            timeOfDay,
            timezone,
          });

          schedule.nextResetTime = nextReset.toISOString();
        } else {
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
      console.error("Failed to create schedule:", error);
      setOffsetError("创建计划失败，请检查输入");
    }
  };

  const resetForm = () => {
    setScheduleType("hourly");
    setInputMethod("offset");
    setIntervalHours("1");
    setOffsetDuration("");
    setNextResetTimeInput("");
    setDayOfWeek("1");
    setDayOfMonth("1");
    setTimeOfDay("00:00");
    setOffsetError("");
    setIntervalError("");
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">额度重置计划</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          添加
        </Button>
      </div>

      {schedules.length > 0 && (
        <div className="space-y-2">
          {schedules.map((schedule) => (
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
                      {schedule.type === "hourly" &&
                        `每${schedule.intervalHours}小时`}
                      {schedule.type === "weekly" &&
                        `每${getDayOfWeekLabel(schedule.dayOfWeek ?? 0)}`}
                      {schedule.type === "monthly" &&
                        `每${schedule.dayOfMonth}日`}
                    </span>
                    {schedule.type !== "hourly" && schedule.timeOfDay && (
                      <span className="text-xs text-muted-foreground">
                        {schedule.timeOfDay}
                      </span>
                    )}
                    {schedule.timezone && schedule.type !== "hourly" && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {getTimezoneAbbr(schedule.timezone)}
                      </span>
                    )}
                  </div>
                  {schedule.nextResetTime && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      下次重置:{" "}
                      {formatNextResetTime(
                        schedule.nextResetTime,
                        schedule.timezone
                      )}
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
                  setIntervalError("");
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">每小时</SelectItem>
                  <SelectItem value="weekly">每周</SelectItem>
                  <SelectItem value="monthly">每月</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">输入方式</Label>
              <Select
                value={inputMethod}
                onValueChange={(value) => {
                  setInputMethod(value as InputMethod);
                  setOffsetError("");
                  setIntervalError("");
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

          {scheduleType === "hourly" && (
            <div className="space-y-2">
              <Label className="text-xs">间隔（小时）</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={intervalHours}
                onChange={(e) => {
                  setIntervalHours(e.target.value);
                  setIntervalError("");
                }}
                className="h-8"
              />
              {intervalError && (
                <div className="text-xs text-red-500">{intervalError}</div>
              )}
            </div>
          )}

          {scheduleType === "weekly" && (
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

          {scheduleType === "monthly" && (
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
            </div>
          )}

          {inputMethod === "direct" && scheduleType === "hourly" && (
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
