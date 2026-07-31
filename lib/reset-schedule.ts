import { ResetSchedule, ResetScheduleType } from './types'
import { v4 as uuidv4 } from 'uuid'

export function calculateNextResetTime(
  schedule: Omit<ResetSchedule, 'id' | 'nextResetTime' | 'createdAt' | 'updatedAt'>
): Date {
  const now = new Date()
  
  switch (schedule.type) {
    case 'hourly':
      return calculateNextHourlyReset(schedule, now)
    case 'daily':
      return calculateNextDailyReset(schedule, now)
    case 'weekly':
      return calculateNextWeeklyReset(schedule, now)
    case 'monthly':
      return calculateNextMonthlyReset(schedule, now)
    default:
      throw new Error(`Unknown schedule type: ${schedule.type}`)
  }
}

function calculateNextHourlyReset(
  schedule: { intervalHours?: number; referenceTime?: string },
  now: Date
): Date {
  if (!schedule.intervalHours || schedule.intervalHours < 1) {
    throw new Error('intervalHours must be a positive number for hourly schedule')
  }

  if (schedule.referenceTime) {
    const refTime = new Date(schedule.referenceTime)
    const diffMs = now.getTime() - refTime.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)
    const intervalsPassed = Math.floor(diffHours / schedule.intervalHours)
    const nextReset = new Date(refTime.getTime() + (intervalsPassed + 1) * schedule.intervalHours * 60 * 60 * 1000)
    return nextReset
  }

  const currentHour = now.getHours()
  const hoursUntilNextInterval = schedule.intervalHours - (currentHour % schedule.intervalHours)
  const nextReset = new Date(now)
  nextReset.setHours(now.getHours() + hoursUntilNextInterval, 0, 0, 0)
  return nextReset
}

function calculateNextDailyReset(
  schedule: { timeOfDay?: string; timezoneOffset?: number },
  now: Date
): Date {
  if (!schedule.timeOfDay) {
    throw new Error('timeOfDay is required for daily schedule')
  }

  const [hours, minutes] = schedule.timeOfDay.split(':').map(Number)
  const nextReset = new Date(now)
  
  if (schedule.timezoneOffset !== undefined) {
    const localTime = new Date(now)
    localTime.setHours(hours, minutes, 0, 0)
    const utcTime = new Date(localTime.getTime() - schedule.timezoneOffset * 60 * 1000)
    nextReset.setTime(utcTime.getTime())
  } else {
    nextReset.setHours(hours, minutes, 0, 0)
  }

  if (nextReset <= now) {
    nextReset.setDate(nextReset.getDate() + 1)
  }

  return nextReset
}

function calculateNextWeeklyReset(
  schedule: { dayOfWeek?: number; timeOfDay?: string; timezoneOffset?: number },
  now: Date
): Date {
  if (schedule.dayOfWeek === undefined || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
    throw new Error('dayOfWeek must be 0-6 for weekly schedule')
  }

  if (!schedule.timeOfDay) {
    throw new Error('timeOfDay is required for weekly schedule')
  }

  const [hours, minutes] = schedule.timeOfDay.split(':').map(Number)
  const nextReset = new Date(now)
  
  if (schedule.timezoneOffset !== undefined) {
    const localTime = new Date(now)
    localTime.setHours(hours, minutes, 0, 0)
    const utcTime = new Date(localTime.getTime() - schedule.timezoneOffset * 60 * 1000)
    nextReset.setTime(utcTime.getTime())
  } else {
    nextReset.setHours(hours, minutes, 0, 0)
  }

  const currentDayOfWeek = now.getDay()
  const daysUntilTarget = (schedule.dayOfWeek - currentDayOfWeek + 7) % 7
  
  if (daysUntilTarget === 0 && nextReset <= now) {
    nextReset.setDate(nextReset.getDate() + 7)
  } else {
    nextReset.setDate(nextReset.getDate() + daysUntilTarget)
  }

  return nextReset
}

function calculateNextMonthlyReset(
  schedule: { dayOfMonth?: number; timeOfDay?: string; timezoneOffset?: number },
  now: Date
): Date {
  if (schedule.dayOfMonth === undefined || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 31) {
    throw new Error('dayOfMonth must be 1-31 for monthly schedule')
  }

  if (!schedule.timeOfDay) {
    throw new Error('timeOfDay is required for monthly schedule')
  }

  const [hours, minutes] = schedule.timeOfDay.split(':').map(Number)
  const nextReset = new Date(now)
  
  if (schedule.timezoneOffset !== undefined) {
    const localTime = new Date(now)
    localTime.setHours(hours, minutes, 0, 0)
    const utcTime = new Date(localTime.getTime() - schedule.timezoneOffset * 60 * 1000)
    nextReset.setTime(utcTime.getTime())
  } else {
    nextReset.setHours(hours, minutes, 0, 0)
  }

  const targetDay = Math.min(schedule.dayOfMonth, getDaysInMonth(nextReset.getFullYear(), nextReset.getMonth()))
  nextReset.setDate(targetDay)

  if (nextReset <= now) {
    nextReset.setMonth(nextReset.getMonth() + 1)
    const newTargetDay = Math.min(schedule.dayOfMonth, getDaysInMonth(nextReset.getFullYear(), nextReset.getMonth()))
    nextReset.setDate(newTargetDay)
  }

  return nextReset
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function createResetSchedule(
  data: {
    type: ResetScheduleType
    enabled?: boolean
    intervalHours?: number
    referenceTime?: string
    timeOfDay?: string
    timezoneOffset?: number
    dayOfWeek?: number
    dayOfMonth?: number
  }
): ResetSchedule {
  const now = new Date().toISOString()
  
  const schedule: Omit<ResetSchedule, 'id' | 'nextResetTime' | 'createdAt' | 'updatedAt'> = {
    type: data.type,
    enabled: data.enabled ?? true,
    intervalHours: data.intervalHours,
    referenceTime: data.referenceTime,
    timeOfDay: data.timeOfDay,
    timezoneOffset: data.timezoneOffset,
    dayOfWeek: data.dayOfWeek,
    dayOfMonth: data.dayOfMonth
  }

  const nextResetTime = calculateNextResetTime(schedule)

  return {
    ...schedule,
    id: uuidv4(),
    nextResetTime: nextResetTime.toISOString(),
    createdAt: now,
    updatedAt: now
  }
}

export function updateResetScheduleNextTime(schedule: ResetSchedule): ResetSchedule {
  const nextResetTime = calculateNextResetTime(schedule)
  return {
    ...schedule,
    nextResetTime: nextResetTime.toISOString(),
    updatedAt: new Date().toISOString()
  }
}

export function shouldResetNow(schedule: ResetSchedule): boolean {
  if (!schedule.enabled) return false
  
  const now = new Date()
  const nextReset = new Date(schedule.nextResetTime)
  
  const diffMs = Math.abs(now.getTime() - nextReset.getTime())
  const diffMinutes = diffMs / (1000 * 60)
  
  return diffMinutes < 5
}