import { RRule } from "rrule";
import { z } from "zod";
import { dateOnly } from "./schemas";
export const recurrenceInput = z
  .object({
    version: z.number().int().positive(),
    rrule: z.string().min(1).max(500),
    start_date: dateOnly,
    end_date: dateOnly.nullable().default(null),
  })
  .strict()
  .refine((r) => !r.end_date || r.end_date >= r.start_date, {
    message: "End date must follow start date.",
  });
/** Date-only recurrence: UTC dates are floating local dates, never appointment instants. */
export function occurrenceDates(
  rule: string,
  start: string,
  end: string | null,
  today: string,
  horizonDays = 90,
): string[] {
  if (
    !/^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)/.test(rule) ||
    /[\r\n]|BYHOUR|BYMINUTE|BYSECOND|TZID|DTSTART/.test(rule)
  )
    throw Error("Use a date-only DAILY, WEEKLY, MONTHLY, or YEARLY RRULE.");
  const options = RRule.parseString(rule.replace(/^RRULE:/, ""));
  if (
    options.interval != null &&
    (options.interval < 1 || options.interval > 3660)
  )
    throw Error("Recurrence interval must be between 1 and 3660.");
  if (options.count != null && (options.count < 1 || options.count > 10000))
    throw Error("Recurrence count exceeds the supported bound.");
  options.dtstart = new Date(start + "T00:00:00Z");
  const recurrence = new RRule(options);
  const lower = new Date((today > start ? today : start) + "T00:00:00Z");
  const upper = new Date(lower);
  upper.setUTCDate(upper.getUTCDate() + Math.min(365, horizonDays));
  if (end && new Date(end + "T23:59:59Z") < upper)
    upper.setTime(+new Date(end + "T23:59:59Z"));
  return [
    ...new Set(
      recurrence
        .between(lower, upper, true)
        .map((d) => d.toISOString().slice(0, 10)),
    ),
  ];
}
