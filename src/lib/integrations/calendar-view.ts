import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
export type CalendarRecord = {
  id: string;
  connection_id: string;
  name: string;
  timezone: string;
  color: string | null;
  access_role: string;
  sync_enabled: boolean;
  last_synced_at: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  sync_error: string | null;
};
export type CalendarEvent = {
  work_session?: {
    block_id: string;
    task_id: string;
    status: string;
    flexibility: string;
  } | null;
  id: string;
  calendar_id: string;
  provider_event_id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day_start: string | null;
  all_day_end: string | null;
  timezone: string;
  busy_status: "busy" | "free";
  raw_metadata: Record<string, unknown>;
  /** Repeats week to week (set by the events endpoint). */
  recurring?: boolean;
};
export type ConnectionState = {
  daily_sync_configured?: boolean;
  daily_runs?: {
    status: string;
    last_error: string | null;
    updated_at: string;
  }[];
  configured: boolean;
  connections: {
    id: string;
    status: string;
    last_sync_at: string | null;
    daily_sync_enabled?: boolean;
  }[];
  calendars: CalendarRecord[];
};
export function eventOnDate(event: CalendarEvent, date: string) {
  if (event.all_day_start && event.all_day_end)
    return event.all_day_start <= date && event.all_day_end > date;
  if (!event.start_at || !event.end_at) return false;
  const start = fromZonedTime(
    date + "T00:00:00",
    "America/Vancouver",
  ).getTime();
  const next = new Date(date + "T12:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const end = fromZonedTime(
    next.toISOString().slice(0, 10) + "T00:00:00",
    "America/Vancouver",
  ).getTime();
  return (
    new Date(event.start_at).getTime() < end &&
    new Date(event.end_at).getTime() > start
  );
}
export function eventTimeLabel(e: CalendarEvent) {
  if (e.all_day_start) return "All day";
  if (!e.start_at || !e.end_at) return "";
  return `${formatInTimeZone(e.start_at, "America/Vancouver", "h:mm a")}–${formatInTimeZone(e.end_at, "America/Vancouver", "h:mm a")}`;
}
