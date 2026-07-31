"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ResetSchedule, ResetScheduleType, ResetScheduleFormData } from "@/lib/types"
import { createResetSchedule } from "@/lib/reset-schedule"
import { formatNextResetTime, getScheduleTypeLabel } from "@/lib/utils"
import { Plus, Trash2, Clock, Globe } from "lucide-react"

interface ResetScheduleConfigProps {
  schedules: ResetSchedule[]
  onChange: (schedules: ResetSchedule[]) => void
}

function getDayOfWeekLabel(dayOfWeek: number): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return days[dayOfWeek] || ''
}

export function ResetScheduleConfig({ schedules, onChange }: ResetScheduleConfigProps) {
  const [newSchedule, setNewSchedule] = useState<ResetScheduleFormData>({
    type: 'daily',
    enabled: true,
    timeOfDay: '00:00'
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [referenceMode, setReferenceMode] = useState<'absolute' | 'relative'>('relative')
  const [currentTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'UTC'
    }
  })

  const getTimezoneAbbr = (timezone?: string): string => {
    if (!timezone) return ''
    const tzMap: Record<string, string> = {
      'Asia/Shanghai': '上海时间',
      'Asia/Hong_Kong': '香港时间',
      'Asia/Tokyo': '东京时间',
      'America/New_York': '纽约时间',
      'America/Los_Angeles': '洛杉矶时间',
      'Europe/London': '伦敦时间',
      'UTC': 'UTC'
    }
    return tzMap[timezone] || timezone.split('/').pop() || timezone
  }

  const handleAddSchedule = () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const timezoneOffset = -new Date().getTimezoneOffset()
    
    const finalSchedule = createResetSchedule({
      ...newSchedule,
      timezone,
      timezoneOffset
    })

    onChange([...schedules, finalSchedule])
    setShowAddForm(false)
    setNewSchedule({
      type: 'daily',
      enabled: true,
      timeOfDay: '00:00'
    })
  }

  const handleRemoveSchedule = (scheduleId: string) => {
    onChange(schedules.filter(s => s.id !== scheduleId))
  }

  const handleToggleSchedule = (scheduleId: string) => {
    onChange(schedules.map(s => 
      s.id === scheduleId ? { ...s, enabled: !s.enabled } : s
    ))
  }

  const handleNewScheduleTypeChange = (type: ResetScheduleType) => {
    setNewSchedule(prev => ({
      ...prev,
      type,
      intervalHours: type === 'hourly' ? 5 : undefined,
      referenceTime: undefined,
      relativeHours: undefined,
      relativeMinutes: undefined,
      dayOfWeek: type === 'weekly' ? 1 : undefined,
      dayOfMonth: type === 'monthly' ? 1 : undefined
    }))
    if (type !== 'hourly') {
      setReferenceMode('absolute')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">额度重置计划</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
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
                      {getScheduleTypeLabel(schedule.type)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {schedule.type === 'hourly' && `每${schedule.intervalHours}小时`}
                      {schedule.type === 'daily' && schedule.timeOfDay}
                      {schedule.type === 'weekly' && `${getDayOfWeekLabel(schedule.dayOfWeek ?? 0)} ${schedule.timeOfDay}`}
                      {schedule.type === 'monthly' && `${schedule.dayOfMonth}日 ${schedule.timeOfDay}`}
                    </span>
                    {schedule.timezone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {getTimezoneAbbr(schedule.timezone)}
                      </span>
                    )}
                  </div>
                  {schedule.nextResetTime && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      下次重置: {formatNextResetTime(schedule.nextResetTime, schedule.timezone)}
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
                value={newSchedule.type}
                onValueChange={(value) => handleNewScheduleTypeChange(value as ResetScheduleType)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">每N小时</SelectItem>
                  <SelectItem value="daily">每日</SelectItem>
                  <SelectItem value="weekly">每周</SelectItem>
                  <SelectItem value="monthly">每月</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newSchedule.type === 'hourly' && (
              <div className="space-y-2">
                <Label className="text-xs">间隔(小时)</Label>
                <Input
                  type="number"
                  min="1"
                  max="168"
                  value={newSchedule.intervalHours || 5}
                  onChange={(e) => setNewSchedule(prev => ({
                    ...prev,
                    intervalHours: parseInt(e.target.value) || 5
                  }))}
                  className="h-8"
                />
              </div>
            )}
          </div>

          {newSchedule.type === 'hourly' && (
            <div className="space-y-2">
              <Label className="text-xs">首次重置时间</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={referenceMode === 'relative' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setReferenceMode('relative')}
                >
                  从现在起
                </Button>
                <Button
                  type="button"
                  variant={referenceMode === 'absolute' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setReferenceMode('absolute')}
                >
                  指定时间点
                </Button>
              </div>
            </div>
          )}

          {newSchedule.type === 'hourly' && referenceMode === 'relative' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">小时</Label>
                <Input
                  type="number"
                  min="0"
                  max="168"
                  value={newSchedule.relativeHours || 0}
                  onChange={(e) => setNewSchedule(prev => ({
                    ...prev,
                    relativeHours: parseInt(e.target.value) || 0,
                    referenceTime: undefined
                  }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">分钟</Label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={newSchedule.relativeMinutes || 0}
                  onChange={(e) => setNewSchedule(prev => ({
                    ...prev,
                    relativeMinutes: parseInt(e.target.value) || 0,
                    referenceTime: undefined
                  }))}
                  className="h-8"
                />
              </div>
            </div>
          )}

          {newSchedule.type === 'hourly' && referenceMode === 'absolute' && (
            <div className="space-y-2">
              <Label className="text-xs">参考时间点</Label>
              <Input
                type="datetime-local"
                value={newSchedule.referenceTime ? new Date(newSchedule.referenceTime).toISOString().slice(0, 16) : ''}
                onChange={(e) => setNewSchedule(prev => ({
                  ...prev,
                  referenceTime: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                  relativeHours: undefined,
                  relativeMinutes: undefined
                }))}
                className="h-8"
              />
            </div>
          )}

          {newSchedule.type === 'weekly' && (
            <div className="space-y-2">
              <Label className="text-xs">星期</Label>
              <Select
                value={String(newSchedule.dayOfWeek ?? 1)}
                onValueChange={(value) => setNewSchedule(prev => ({
                  ...prev,
                  dayOfWeek: parseInt(value)
                }))}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6].map(day => (
                    <SelectItem key={day} value={String(day)}>
                      {getDayOfWeekLabel(day)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {newSchedule.type === 'monthly' && (
            <div className="space-y-2">
              <Label className="text-xs">日期</Label>
              <Select
                value={String(newSchedule.dayOfMonth ?? 1)}
                onValueChange={(value) => setNewSchedule(prev => ({
                  ...prev,
                  dayOfMonth: parseInt(value)
                }))}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                    <SelectItem key={day} value={String(day)}>
                      {day}日
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">时间</Label>
              <Input
                type="time"
                value={newSchedule.timeOfDay || '00:00'}
                onChange={(e) => setNewSchedule(prev => ({
                  ...prev,
                  timeOfDay: e.target.value
                }))}
                className="h-8"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">时区</Label>
              <div className="flex items-center gap-2 h-8 px-3 py-1 border rounded-md bg-muted/50">
                <Globe className="h-3 w-3" />
                <span className="text-xs">{getTimezoneAbbr(currentTimezone)}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAddSchedule}
            >
              确定
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}