import { NextResponse } from "next/server";
import { z } from "zod";
import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, failure, dbError } from "@/lib/http";
import { localDate, TIMEZONE } from "@/lib/dates";
import {
  connectionAccess,
  collectWindowEvents,
  integrationRpc,
} from "@/lib/integrations/google-server";
export const maxDuration = 60;
export async function POST(request: Request) {
  let lease: string | undefined;
  let userId: string | undefined;
  let calendarId: string | undefined;
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    userId = user.id;
    const input = z
      .object({ calendar_id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    calendarId = input.calendar_id;
    const { data: calendar, error } = await db
      .from("calendars")
      .select("id,connection_id,provider_calendar_id,timezone,sync_enabled")
      .eq("user_id", user.id)
      .eq("id", calendarId)
      .single();
    dbError(error);
    if (!calendar?.sync_enabled)
      throw new ApiError(422, "Select this calendar before syncing.");
    const { token } = await connectionAccess(calendar.connection_id);
    lease = await integrationRpc<string>("google_claim_sync", {
      p_user: user.id,
      p_calendar: calendarId,
    });
    const today = new Date(localDate() + "T12:00:00Z");
    const boundary = (n: number) =>
      fromZonedTime(
        format(addDays(today, n), "yyyy-MM-dd") + "T00:00:00",
        TIMEZONE,
      ).toISOString();
    const start = boundary(-30);
    const end = boundary(91);
    const events = await collectWindowEvents(
      token,
      calendar.provider_calendar_id,
      calendar.timezone,
      start,
      end,
    );
    const count = await integrationRpc<number>("google_finish_sync", {
      p_user: user.id,
      p_calendar: calendarId,
      p_lease: lease,
      p_start: start,
      p_end: end,
      p_events: events,
    });
    return NextResponse.json({
      count,
      coverage_start: start,
      coverage_end: end,
    });
  } catch (e) {
    if (lease && userId && calendarId) {
      try {
        await integrationRpc("google_fail_sync", {
          p_user: userId,
          p_calendar: calendarId,
          p_lease: lease,
          p_error:
            e instanceof ApiError
              ? e.message
              : "Synchronization failed; cached events were kept. Try again.",
        });
      } catch {
        /* A crashed lease expires automatically; never log credentials or raw provider errors. */
      }
    }
    return failure(e);
  }
}
