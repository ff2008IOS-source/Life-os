import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
/** Calendar dates are interpreted in the owner's zone, never the server's UTC day. */
export function reviewAvailability(
  now = new Date(),
  timezone = "America/Vancouver",
) {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const weekday = Number(formatInTimeZone(now, timezone, "i"));
  const shift = (n: number) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const sunday = shift(7 - weekday);
  return {
    today,
    timezone,
    open: weekday === 7,
    weekStart: shift(1 - weekday),
    weekEnd: sunday,
    opensAt: fromZonedTime(sunday + "T00:00:00", timezone).toISOString(),
  };
}
export function assessmentTiming(
  a: { due_at?: string | null; due_date?: string | null },
  now: Date,
  timezone: string,
) {
  if (a.due_at)
    return Date.parse(a.due_at) < now.getTime() ? "past" : "upcoming";
  if (a.due_date)
    return a.due_date < formatInTimeZone(now, timezone, "yyyy-MM-dd")
      ? "past"
      : "upcoming";
  return "undated";
}
