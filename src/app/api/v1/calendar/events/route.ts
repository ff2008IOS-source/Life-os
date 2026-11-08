import { calendarDisplayEvents } from "@/lib/integrations/calendar-display-server";
import type { CalendarEvent } from "@/lib/integrations/calendar-view";
import { NextResponse } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const params = new URL(request.url).searchParams;
    const range = z
      .object({ start: z.iso.date(), end: z.iso.date() })
      .refine(
        (x) =>
          x.end > x.start &&
          new Date(x.end).getTime() - new Date(x.start).getTime() <=
            125 * 86400000,
      )
      .parse({ start: params.get("start"), end: params.get("end") });
    const { data: calendars, error } = await db
      .from("calendars")
      .select("id")
      .eq("user_id", user.id)
      .eq("sync_enabled", true);
    dbError(error);
    if (!calendars?.length) return NextResponse.json({ events: [] });
    const events: CalendarEvent[] = [];
    const lower = fromZonedTime(
      range.start + "T00:00:00",
      "America/Vancouver",
    ).toISOString();
    const upper = fromZonedTime(
      range.end + "T00:00:00",
      "America/Vancouver",
    ).toISOString();
    for (let page = 0; page < 20; page++) {
      const result = await db
        .from("calendar_events")
        .select(
          "id,calendar_id,provider_event_id,title,start_at,end_at,all_day_start,all_day_end,timezone,busy_status,raw_metadata",
        )
        .eq("user_id", user.id)
        .in(
          "calendar_id",
          calendars.map((c) => c.id),
        )
        .neq("event_status", "cancelled")
        .or(
          `and(start_at.lt.${upper},end_at.gt.${lower}),and(all_day_start.lt.${range.end},all_day_end.gt.${range.start})`,
        )
        .order("id")
        .range(page * 500, page * 500 + 499);
      dbError(result.error);
      events.push(...(result.data ?? []));
      if (!result.data || result.data.length < 500)
        return NextResponse.json(
          { events: await calendarDisplayEvents(db, user.id, events) },
          { headers: { "Cache-Control": "no-store" } },
        );
    }
    throw Error(
      "Calendar display limit exceeded; no truncated results returned.",
    );
  } catch (e) {
    return failure(e);
  }
}
