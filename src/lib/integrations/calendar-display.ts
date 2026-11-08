import { fromZonedTime } from "date-fns-tz";
import { eventOnDate, type CalendarEvent } from "./calendar-view";
import type { EventGroup } from "./calendar-layout";
export type DisplayBlock = {
  id: string;
  task_id: string;
  calendar_event_id: string | null;
  provider_event_id: string | null;
  status: string;
  flexibility: string;
};
export function linkCalendarSessions(
  events: CalendarEvent[],
  blocks: DisplayBlock[],
): CalendarEvent[] {
  const byEvent = new Map(
    blocks
      .filter((b) => b.calendar_event_id)
      .map((b) => [b.calendar_event_id, b]),
  );
  return events.map((e) => {
    const b = byEvent.get(e.id);
    // Provider-confirmed identity is required; names and matching times are insufficient.
    const owned = b && b.provider_event_id === e.provider_event_id;
    return {
      ...e,
      work_session: owned
        ? {
            block_id: b.id,
            task_id: b.task_id,
            status: b.status,
            flexibility: b.flexibility,
          }
        : null,
    };
  });
}
export function calendarKind(event: CalendarEvent) {
  return event.work_session ? "sessions" : "commitments";
}
export function calendarKindLabel(event: CalendarEvent) {
  return event.work_session
    ? `${event.work_session.flexibility === "fixed" ? "Fixed" : "Flexible"} work session`
    : "Imported commitment";
}
/** Informational overlap only. Display filters never change scheduling availability. */
export function sessionOverlaps(groups: EventGroup[], day: string) {
  const on = groups.filter((g) => eventOnDate(g.event, day));
  const interval = (e: CalendarEvent) => ({
    start: Date.parse(
      e.start_at ??
        fromZonedTime(
          e.all_day_start + "T00:00:00",
          "America/Vancouver",
        ).toISOString(),
    ),
    end: Date.parse(
      e.end_at ??
        fromZonedTime(
          e.all_day_end + "T00:00:00",
          "America/Vancouver",
        ).toISOString(),
    ),
  });
  const conflicts = new Set<string>();
  for (const g of on.filter(
    (g) => g.event.work_session?.status === "planned",
  )) {
    const a = interval(g.event);
    if (
      on.some((other) => {
        if (
          other.id === g.id ||
          other.event.busy_status !== "busy" ||
          other.event.work_session?.status === "cancelled"
        )
          return false;
        const b = interval(other.event);
        return a.start < b.end && b.start < a.end;
      })
    )
      conflicts.add(g.id);
  }
  return conflicts;
}
