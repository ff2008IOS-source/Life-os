import { fromZonedTime } from "date-fns-tz";
import type { Busy } from "./scheduler";
export type AvailabilityEvent = {
  start_at: string | null;
  end_at: string | null;
  all_day_start: string | null;
  all_day_end: string | null;
  timezone: string;
  busy_status: string;
  event_status: string;
};
/** All-day end dates are exclusive in the source calendar's timezone. */
export function calendarBusy(events: AvailabilityEvent[]): Busy[] {
  return events
    .filter((e) => e.busy_status === "busy" && e.event_status !== "cancelled")
    .map((e) => {
      const start =
        e.start_at ??
        (e.all_day_start
          ? fromZonedTime(
              e.all_day_start + "T00:00:00",
              e.timezone,
            ).toISOString()
          : null);
      const end =
        e.end_at ??
        (e.all_day_end
          ? fromZonedTime(e.all_day_end + "T00:00:00", e.timezone).toISOString()
          : null);
      if (
        !start ||
        !end ||
        !Number.isFinite(Date.parse(start)) ||
        Date.parse(end) <= Date.parse(start)
      )
        throw Error(
          "Calendar availability contains an invalid range. Refresh before planning.",
        );
      return { start_at: start, end_at: end };
    });
}
