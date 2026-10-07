import { ResetSchedule } from "@/lib/types";
import { sortResetSchedules } from "@/lib/reset-schedule";
import {
  formatNextResetTime,
  formatResetTimeTooltip,
  getScheduleTypeLabel,
} from "@/lib/utils";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ResetScheduleGrid({
  schedules,
  onToggle,
}: {
  schedules: ResetSchedule[];
  onToggle: (scheduleId: string, exhausted: boolean) => void;
}) {
  return (
    <div className="pt-2">
      <span className="text-sm text-muted-foreground">额度重置计划</span>
      <div
        className="mt-1 grid gap-y-1 text-xs"
        style={{ gridTemplateColumns: "auto 3.5rem 1fr auto" }}
      >
        {sortResetSchedules(schedules)
          .filter((s) => s.enabled)
          .map((schedule) => (
            <div key={schedule.id} className="contents">
              <Clock className="h-3 w-3 text-muted-foreground self-center" />
              <span className="font-medium self-center">
                {getScheduleTypeLabel(schedule.type)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground self-center">
                    {formatNextResetTime(schedule.nextResetTime)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {formatResetTimeTooltip(
                    schedule.nextResetTime,
                    schedule.timezone
                  )}
                </TooltipContent>
              </Tooltip>
              <Button
                variant={schedule.exhausted ? "destructive" : "outline"}
                size="sm"
                className="h-5 px-2 text-xs"
                onClick={() => onToggle(schedule.id, !schedule.exhausted)}
              >
                {schedule.exhausted ? "已用尽" : "可用"}
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
