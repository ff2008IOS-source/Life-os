import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "../http";
import type { CalendarEvent } from "./calendar-view";
import { linkCalendarSessions, type DisplayBlock } from "./calendar-display";
/** Read only owned links. Chunk IDs to bound PostgREST URLs and response sizes. */
export async function calendarDisplayEvents(
  db: SupabaseClient,
  user: string,
  events: CalendarEvent[],
) {
  const blocks: DisplayBlock[] = [];
  for (let offset = 0; offset < events.length; offset += 100) {
    const rows = await db
      .from("work_blocks")
      .select(
        "id,task_id,calendar_event_id,provider_event_id,status,flexibility,version",
      )
      .eq("user_id", user)
      .in(
        "calendar_event_id",
        events.slice(offset, offset + 100).map((e) => e.id),
      )
      .limit(101);
    dbError(rows.error);
    if ((rows.data?.length ?? 0) > 100)
      throw Error("Calendar reservation link limit exceeded.");
    blocks.push(...(rows.data ?? []));
  }
  return linkCalendarSessions(events, blocks);
}
