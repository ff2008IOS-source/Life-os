import "server-only";
import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { ApiError } from "@/lib/auth";
import { localDate, TIMEZONE } from "@/lib/dates";
import { dbError } from "@/lib/http";
import {
  integrationAdmin,
  connectionAccessForUser,
  collectWindowEvents,
  integrationRpc,
} from "./google-server";
/** Only approved server callers can select a user. No public request supplies this ID. */
export async function syncCalendarForUser(userId: string, calendarId: string) {
  let lease: string | undefined;
  try {
    const { data: calendar, error } = await integrationAdmin()
      .from("calendars")
      .select("id,connection_id,provider_calendar_id,timezone,sync_enabled")
      .eq("user_id", userId)
      .eq("id", calendarId)
      .single();
    dbError(error);
    if (!calendar?.sync_enabled)
      throw new ApiError(422, "Select this calendar before syncing.");
    const { token } = await connectionAccessForUser(
      userId,
      calendar.connection_id,
    );
    lease = await integrationRpc<string>("google_claim_sync", {
      p_user: userId,
      p_calendar: calendarId,
    });
    const today = new Date(localDate() + "T12:00Z");
    const boundary = (n: number) =>
      fromZonedTime(
        format(addDays(today, n), "yyyy-MM-dd") + "T00:00:00",
        TIMEZONE,
      ).toISOString();
    const start = boundary(-30),
      end = boundary(91);
    const events = await collectWindowEvents(
      token,
      calendar.provider_calendar_id,
      calendar.timezone,
      start,
      end,
    );
    const count = await integrationRpc<number>("google_finish_sync", {
      p_user: userId,
      p_calendar: calendarId,
      p_lease: lease,
      p_start: start,
      p_end: end,
      p_events: events,
    });
    return { count, coverage_start: start, coverage_end: end };
  } catch (error) {
    if (lease)
      try {
        await integrationRpc("google_fail_sync", {
          p_user: userId,
          p_calendar: calendarId,
          p_lease: lease,
          p_error:
            error instanceof ApiError
              ? error.message
              : "Synchronization failed; cached events were kept.",
        });
      } catch {
        /* Expired lease is retriable. Never log raw provider errors. */
      }
    throw error;
  }
}
