import { fromZonedTime } from "date-fns-tz";
import type { Busy } from "./scheduler";
export const CALENDAR_FRESH_MS = 5 * 60 * 1000;
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

/** Coverage and freshness are required together; an empty source list is not free time. */
export function calendarCoverage(input: {
  calendars: {
    id: string;
    connection_id: string;
    sync_enabled: boolean;
    last_synced_at: string | null;
    sync_error: string | null;
    coverage_start: string | null;
    coverage_end: string | null;
  }[];
  connections: { id: string; status: string }[];
  start: number;
  end: number;
  now: number;
  failed?: boolean;
}) {
  const selected = input.calendars.filter((c) => c.sync_enabled);
  const verified =
    !input.failed &&
    selected.length > 0 &&
    selected.every(
      (c) =>
        !c.sync_error &&
        !!c.last_synced_at &&
        input.now - Date.parse(c.last_synced_at) <= CALENDAR_FRESH_MS &&
        !!c.coverage_start &&
        !!c.coverage_end &&
        Date.parse(c.coverage_start) <= input.start &&
        Date.parse(c.coverage_end) >= input.end &&
        input.connections.some(
          (a) => a.id === c.connection_id && a.status === "connected",
        ),
    );
  return {
    verified,
    lastSuccess:
      selected.length && selected.every((c) => !!c.last_synced_at)
        ? selected.map((c) => c.last_synced_at!).sort()[0]
        : null,
  };
}
