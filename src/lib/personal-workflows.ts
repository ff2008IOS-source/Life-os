import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays, format } from "date-fns";
export const workflowType = z.enum(["daily_check", "career_debrief"]);
export const workflowSetting = z
  .object({
    workflow_type: workflowType,
    enabled: z.boolean(),
    run_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.number().int().min(1).max(7),
  })
  .strict();
export type WorkflowSetting = z.infer<typeof workflowSetting>;
export function eligibleWorkflow(setting: WorkflowSetting, now: Date) {
  const zone = "America/Vancouver",
    local = formatInTimeZone(now, zone, "yyyy-MM-dd"),
    clock = formatInTimeZone(now, zone, "HH:mm");
  let date = new Date(local + "T12:00:00Z");
  if (setting.workflow_type === "daily_check") {
    if (clock < setting.run_time) date = addDays(date, -1);
  } else {
    const dow = Number(formatInTimeZone(date, "UTC", "i"));
    let days = (dow - setting.weekday + 7) % 7;
    if (days === 0 && clock < setting.run_time) days = 7;
    date = addDays(date, -days);
  }
  const day = format(date, "yyyy-MM-dd");
  return {
    key: `scheduled:${setting.workflow_type}:${day}`,
    scheduled_for: fromZonedTime(
      day + "T" + setting.run_time,
      zone,
    ).toISOString(),
  };
}
