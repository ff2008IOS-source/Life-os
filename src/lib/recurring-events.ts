import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Events that repeat week to week. Two repeating events that overlap are a
 * standing arrangement the owner already knows about, not a clash; only an
 * overlap involving a one-off event deserves a warning.
 *
 * An event repeats when Google marks it as an instance of a recurring series,
 * or when an event with the same title starts at the same local time one or two
 * weeks earlier or later (weekly events created by hand).
 */
export type RecurrenceInput = {
  id: string;
  title: string;
  start_at: string | null;
  raw_metadata?: Record<string, unknown> | null;
};

const ZONE = "America/Vancouver";
const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

function shiftLocal(start: string, days: number) {
  const local = formatInTimeZone(start, ZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const d = new Date(local.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return fromZonedTime(
    d.toISOString().slice(0, 10) + local.slice(10),
    ZONE,
  ).getTime();
}

export function recurringEventIds(events: RecurrenceInput[]) {
  const starts = new Set(
    events
      .filter((e) => e.start_at)
      .map((e) => `${norm(e.title)}|${Date.parse(e.start_at!)}`),
  );
  const ids = new Set<string>();
  for (const e of events) {
    if (e.raw_metadata && e.raw_metadata.recurring_event_id) {
      ids.add(e.id);
      continue;
    }
    if (!e.start_at || !norm(e.title)) continue;
    const title = norm(e.title);
    if (
      [-14, -7, 7, 14].some((days) =>
        starts.has(`${title}|${shiftLocal(e.start_at!, days)}`),
      )
    )
      ids.add(e.id);
  }
  return ids;
}
