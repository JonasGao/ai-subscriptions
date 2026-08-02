import { ResetSchedule, ResetScheduleType } from "./types";
import { v4 as uuidv4 } from "uuid";

export function validateResetSchedule(schedule: Partial<ResetSchedule>): void {
  if (!schedule.type) {
    throw new Error("Schedule type is required");
  }

  if (!["hourly", "weekly", "monthly"].includes(schedule.type)) {
    throw new Error(
      `Invalid schedule type '${schedule.type}'. Supported types: hourly, weekly, monthly`
    );
  }

  if ("referenceTime" in schedule) {
    throw new Error(
      "Field 'referenceTime' is no longer supported. Use nextResetTime instead."
    );
  }

  if ("timezoneOffset" in schedule) {
    throw new Error(
      "Field 'timezoneOffset' is no longer supported. Use timezone instead."
    );
  }
}

export function parseDurationString(
  duration: string
): { days: number; hours: number; minutes: number } | null {
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
}

export function formatDuration(
  days: number,
  hours: number,
  minutes: number
): string {
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(" ") || "0m";
}

export function calculateNextResetTime(
  schedule: Omit<
    ResetSchedule,
    "id" | "nextResetTime" | "createdAt" | "updatedAt"
  >
): Date {
  const now = new Date();

  switch (schedule.type) {
    case "hourly":
      return calculateNextHourlyReset(schedule, now);
    case "weekly":
      return calculateNextWeeklyReset(schedule, now);
    case "monthly":
      return calculateNextMonthlyReset(schedule, now);
    default:
      throw new Error(`Unknown schedule type: ${schedule.type}`);
  }
}

function calculateNextHourlyReset(
  schedule: { intervalHours?: number },
  now: Date
): Date {
  if (!schedule.intervalHours || schedule.intervalHours < 1) {
    throw new Error(
      "intervalHours must be a positive number for hourly schedule"
    );
  }

  const intervalMs = schedule.intervalHours * 60 * 60 * 1000;
  const nextReset = new Date(now.getTime() + intervalMs);
  return nextReset;
}

function calculateNextWeeklyReset(
  schedule: {
    dayOfWeek?: number;
    timeOfDay?: string;
    timezone?: string;
    timezoneOffset?: number;
  },
  now: Date
): Date {
  if (
    schedule.dayOfWeek === undefined ||
    schedule.dayOfWeek < 0 ||
    schedule.dayOfWeek > 6
  ) {
    throw new Error("dayOfWeek must be 0-6 for weekly schedule");
  }

  if (!schedule.timeOfDay) {
    throw new Error("timeOfDay is required for weekly schedule");
  }

  const [hours, minutes] = schedule.timeOfDay.split(":").map(Number);
  const nextReset = new Date(now);

  if (schedule.timezone) {
    try {
      const nowInTz = new Date(
        now.toLocaleString("en-US", { timeZone: schedule.timezone })
      );
      const targetTime = new Date(
        now.toLocaleString("en-US", { timeZone: schedule.timezone })
      );
      targetTime.setHours(hours, minutes, 0, 0);

      const currentDayOfWeek = nowInTz.getDay();
      const daysUntilTarget = (schedule.dayOfWeek - currentDayOfWeek + 7) % 7;

      if (daysUntilTarget === 0 && targetTime <= nowInTz) {
        targetTime.setDate(targetTime.getDate() + 7);
      } else {
        targetTime.setDate(targetTime.getDate() + daysUntilTarget);
      }

      const offset = now.getTime() - nowInTz.getTime();
      nextReset.setTime(targetTime.getTime() + offset);
    } catch {
      nextReset.setHours(hours, minutes, 0, 0);
      const currentDayOfWeek = now.getDay();
      const daysUntilTarget = (schedule.dayOfWeek - currentDayOfWeek + 7) % 7;
      if (daysUntilTarget === 0 && nextReset <= now) {
        nextReset.setDate(nextReset.getDate() + 7);
      } else {
        nextReset.setDate(nextReset.getDate() + daysUntilTarget);
      }
    }
  } else {
    nextReset.setHours(hours, minutes, 0, 0);
    const currentDayOfWeek = now.getDay();
    const daysUntilTarget = (schedule.dayOfWeek - currentDayOfWeek + 7) % 7;
    if (daysUntilTarget === 0 && nextReset <= now) {
      nextReset.setDate(nextReset.getDate() + 7);
    } else {
      nextReset.setDate(nextReset.getDate() + daysUntilTarget);
    }
  }

  return nextReset;
}

function calculateNextMonthlyReset(
  schedule: {
    dayOfMonth?: number;
    timeOfDay?: string;
    timezone?: string;
    timezoneOffset?: number;
  },
  now: Date
): Date {
  if (
    schedule.dayOfMonth === undefined ||
    schedule.dayOfMonth < 1 ||
    schedule.dayOfMonth > 31
  ) {
    throw new Error("dayOfMonth must be 1-31 for monthly schedule");
  }

  if (!schedule.timeOfDay) {
    throw new Error("timeOfDay is required for monthly schedule");
  }

  const [hours, minutes] = schedule.timeOfDay.split(":").map(Number);
  const nextReset = new Date(now);

  if (schedule.timezone) {
    try {
      const nowInTz = new Date(
        now.toLocaleString("en-US", { timeZone: schedule.timezone })
      );
      const targetTime = new Date(
        now.toLocaleString("en-US", { timeZone: schedule.timezone })
      );
      targetTime.setHours(hours, minutes, 0, 0);

      const targetDay = Math.min(
        schedule.dayOfMonth,
        getDaysInMonth(targetTime.getFullYear(), targetTime.getMonth())
      );
      targetTime.setDate(targetDay);

      if (targetTime <= nowInTz) {
        targetTime.setMonth(targetTime.getMonth() + 1);
        const newTargetDay = Math.min(
          schedule.dayOfMonth,
          getDaysInMonth(targetTime.getFullYear(), targetTime.getMonth())
        );
        targetTime.setDate(newTargetDay);
      }

      const offset = now.getTime() - nowInTz.getTime();
      nextReset.setTime(targetTime.getTime() + offset);
    } catch {
      nextReset.setHours(hours, minutes, 0, 0);
      const targetDay = Math.min(
        schedule.dayOfMonth,
        getDaysInMonth(nextReset.getFullYear(), nextReset.getMonth())
      );
      nextReset.setDate(targetDay);
      if (nextReset <= now) {
        nextReset.setMonth(nextReset.getMonth() + 1);
        const newTargetDay = Math.min(
          schedule.dayOfMonth,
          getDaysInMonth(nextReset.getFullYear(), nextReset.getMonth())
        );
        nextReset.setDate(newTargetDay);
      }
    }
  } else {
    nextReset.setHours(hours, minutes, 0, 0);
    const targetDay = Math.min(
      schedule.dayOfMonth,
      getDaysInMonth(nextReset.getFullYear(), nextReset.getMonth())
    );
    nextReset.setDate(targetDay);
    if (nextReset <= now) {
      nextReset.setMonth(nextReset.getMonth() + 1);
      const newTargetDay = Math.min(
        schedule.dayOfMonth,
        getDaysInMonth(nextReset.getFullYear(), nextReset.getMonth())
      );
      nextReset.setDate(newTargetDay);
    }
  }

  return nextReset;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function createResetSchedule(data: {
  type: ResetScheduleType;
  enabled?: boolean;
  intervalHours?: number;
  timeOfDay?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}): ResetSchedule {
  const now = new Date();

  const schedule: Omit<
    ResetSchedule,
    "id" | "nextResetTime" | "createdAt" | "updatedAt"
  > = {
    type: data.type,
    enabled: data.enabled ?? true,
    intervalHours: data.intervalHours,
    timeOfDay: data.timeOfDay,
    timezone: data.timezone,
    dayOfWeek: data.dayOfWeek,
    dayOfMonth: data.dayOfMonth,
    exhausted: false,
  };

  const nextResetTime = calculateNextResetTime(schedule);

  return {
    ...schedule,
    id: uuidv4(),
    nextResetTime: nextResetTime.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function updateResetScheduleNextTime(
  schedule: ResetSchedule
): ResetSchedule {
  const nextResetTime = calculateNextResetTime(schedule);
  return {
    ...schedule,
    nextResetTime: nextResetTime.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function shouldResetNow(schedule: ResetSchedule): boolean {
  if (!schedule.enabled) return false;

  const now = new Date();
  const nextReset = new Date(schedule.nextResetTime);

  const diffMs = Math.abs(now.getTime() - nextReset.getTime());
  const diffMinutes = diffMs / (1000 * 60);

  return diffMinutes < 5;
}
