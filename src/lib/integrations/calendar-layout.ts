import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { eventOnDate, type CalendarEvent } from "./calendar-view";
export type EventGroup = {
  id: string;
  event: CalendarEvent;
  sources: CalendarEvent[];
};
/** Display grouping only. Source records and provider identities are never changed. */
export function groupCalendarEvents(
  events: CalendarEvent[],
  group = true,
): EventGroup[] {
  const result = new Map<string, EventGroup>();
  for (const event of events) {
    const key = group
      ? JSON.stringify([
          event.title.trim().replace(/\s+/g, " "),
          event.start_at,
          event.end_at,
          event.all_day_start,
          event.all_day_end,
        ])
      : event.id;
    const existing = result.get(key);
    if (existing) existing.sources.push(event);
    else result.set(key, { id: event.id, event, sources: [event] });
  }
  return [...result.values()].sort((a, b) =>
    (a.event.start_at ?? a.event.all_day_start ?? "").localeCompare(
      b.event.start_at ?? b.event.all_day_start ?? "",
    ),
  );
}
export function calendarMinutes(event: CalendarEvent, day: string) {
  const next = new Date(day + "T12:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const start = fromZonedTime(day + "T00:00:00", "America/Vancouver").getTime();
  const end = fromZonedTime(
    next.toISOString().slice(0, 10) + "T00:00:00",
    "America/Vancouver",
  ).getTime();
  if (!event.start_at || !event.end_at) return { start: 0, end: 1440 };
  const minutes = (time: string) => {
    const local = formatInTimeZone(time, "America/Vancouver", "HH:mm")
      .split(":")
      .map(Number);
    return local[0] * 60 + local[1];
  };
  return {
    start:
      new Date(event.start_at).getTime() <= start ? 0 : minutes(event.start_at),
    end: new Date(event.end_at).getTime() >= end ? 1440 : minutes(event.end_at),
  };
}
export function layoutDay(groups: EventGroup[], day: string) {
  const items = groups
    .filter((g) => !g.event.all_day_start && eventOnDate(g.event, day))
    .map((g) => ({
      ...g,
      ...calendarMinutes(g.event, day),
      column: 0,
      columns: 1,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: typeof items = [];
  let ends: number[] = [];
  let clusterEnd = -1;
  const finish = () => {
    for (const item of cluster) item.columns = ends.length;
    cluster = [];
    ends = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd) {
      finish();
      clusterEnd = -1;
    }
    let col = ends.findIndex((end) => end <= item.start);
    if (col === -1) col = ends.length;
    item.column = col;
    ends[col] = item.end;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  finish();
  return items;
}
