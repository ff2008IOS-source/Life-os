import { z } from "zod";
// Provider adapter is transport-injected. No personal account or tokens are loaded here.
const eventTime = z.object({
  date: z.iso.date().optional(),
  dateTime: z.iso.datetime({ offset: true }).optional(),
  timeZone: z.string().optional(),
});
export const googleEventSchema = z.object({
  id: z.string().min(1),
  iCalUID: z.string().optional(),
  summary: z.string().optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  start: eventTime.optional(),
  end: eventTime.optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  etag: z.string().optional(),
  updated: z.iso.datetime({ offset: true }).optional(),
  recurringEventId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
  originalStartTime: eventTime.optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;
export type NormalizedEvent = {
  provider_event_id: string;
  provider_ical_uid: string | null;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day_start: string | null;
  all_day_end: string | null;
  timezone: string;
  busy_status: "busy" | "free";
  event_status: "confirmed" | "tentative" | "cancelled";
  etag: string | null;
  provider_updated_at: string | null;
  protection_level: "protected";
  raw_metadata: {
    recurring_event_id?: string;
    original_start?: z.infer<typeof eventTime>;
  };
};
export function normalizeGoogleEvent(
  value: unknown,
  calendarTimezone: string,
): NormalizedEvent {
  const e = googleEventSchema.parse(value);
  const cancelled = e.status === "cancelled";
  const timed = !!e.start?.dateTime && !!e.end?.dateTime;
  const allDay = !!e.start?.date && !!e.end?.date;
  if (
    !cancelled &&
    (timed === allDay ||
      (timed && new Date(e.end!.dateTime!) <= new Date(e.start!.dateTime!)) ||
      (allDay && e.end!.date! <= e.start!.date!))
  )
    throw Error("Provider event has an invalid time range");
  return {
    provider_event_id: e.id,
    provider_ical_uid: e.iCalUID ?? null,
    title: e.summary ?? "",
    start_at: timed ? new Date(e.start!.dateTime!).toISOString() : null,
    end_at: timed ? new Date(e.end!.dateTime!).toISOString() : null,
    all_day_start: allDay ? e.start!.date! : null,
    all_day_end: allDay ? e.end!.date! : null,
    timezone: e.start?.timeZone ?? calendarTimezone,
    busy_status: e.transparency === "transparent" ? "free" : "busy",
    event_status: e.status,
    etag: e.etag ?? null,
    provider_updated_at: e.updated ?? null,
    protection_level: "protected",
    raw_metadata: {
      ...(e.recurringEventId ? { recurring_event_id: e.recurringEventId } : {}),
      ...(e.originalStartTime ? { original_start: e.originalStartTime } : {}),
    },
  };
}
export class CalendarHttpError extends Error {
  constructor(public status: number) {
    super(`Calendar provider returned ${status}`);
  }
}
export type CalendarPage = {
  items: unknown[];
  nextPageToken?: string;
  nextSyncToken?: string;
};
export type CalendarTransport = (
  calendarId: string,
  params: Record<string, string>,
) => Promise<CalendarPage>;
/** Persister must atomically commit events and cursor, after all pages succeed. */
export async function collectCalendarSync(
  transport: CalendarTransport,
  calendarId: string,
  timezone: string,
  cursor: string | null,
): Promise<{ events: NormalizedEvent[]; cursor: string; fullResync: boolean }> {
  async function collect(token: string | null) {
    const events = new Map<string, NormalizedEvent>();
    let pageToken: string | undefined;
    const pages = new Set<string>();
    let nextCursor: string | undefined;
    do {
      if (pageToken && pages.has(pageToken))
        throw Error("Provider repeated a page token");
      if (pageToken) pages.add(pageToken);
      if (pages.size > 1000) throw Error("Sync page limit exceeded");
      const page = await transport(calendarId, {
        showDeleted: "true",
        singleEvents: "false",
        maxResults: "2500",
        ...(token ? { syncToken: token } : {}),
        ...(pageToken ? { pageToken } : {}),
      });
      for (const value of page.items) {
        const event = normalizeGoogleEvent(value, timezone);
        events.set(event.provider_event_id, event);
      }
      pageToken = page.nextPageToken;
      nextCursor = page.nextSyncToken;
    } while (pageToken);
    if (!nextCursor) throw Error("Provider did not return a sync cursor");
    return { events: [...events.values()], cursor: nextCursor };
  }
  try {
    return { ...(await collect(cursor)), fullResync: cursor === null };
  } catch (e) {
    if (e instanceof CalendarHttpError && e.status === 410 && cursor)
      return { ...(await collect(null)), fullResync: true };
    throw e;
  }
}
/** Never trust mutable browser-visible flags as authority for provider writes. */
export function assertOwnedCalendarWrite(input: {
  stageCApproved: boolean;
  paused: boolean;
  calendarId: string;
  registeredOwnedCalendarId: string | null;
  eventIsLifeOsOwned: boolean;
}) {
  if (
    !input.stageCApproved ||
    input.paused ||
    !input.registeredOwnedCalendarId ||
    input.calendarId !== input.registeredOwnedCalendarId ||
    !input.eventIsLifeOsOwned
  )
    throw Error("Calendar write is not authorized");
}
