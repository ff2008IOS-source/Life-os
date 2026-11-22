import "server-only";
import { reconcileManagedCalendar } from "./calendar-reconcile-server";
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
export async function syncCalendarForUser(
  userId: string,
  calendarId: string,
  writerLease?: string,
) {
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
    let managed;
    try {
      managed = await reconcileManagedCalendar(userId, calendarId, writerLease);
    } catch (e) {
      await integrationAdmin()
        .from("calendars")
        .update({
          sync_error:
            "Managed work sessions need reconciliation. Sync this calendar again before planning.",
        })
        .eq("user_id", userId)
        .eq("id", calendarId);
      throw e;
    }
    // Proposals never move provider events. A failure here must not turn a confirmed sync into a failed sync.
    let planning_pending = false;
    try {
      const { generatePlanningDecisions } =
        await import("../services/planning-decisions");
      await generatePlanningDecisions(userId);
    } catch {
      planning_pending = true;
    }
    return {
      count,
      coverage_start: start,
      coverage_end: end,
      managed,
      planning_pending,
    };
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
/** Read-only periodic reconciliation uses the existing signed worker. */
export async function managedCalendarWorker() {
  const rows = await integrationAdmin()
    .from("calendars")
    .select("id,user_id,last_synced_at")
    .eq("is_life_os_owned", true)
    .eq("write_enabled", true)
    .eq("sync_enabled", true)
    .limit(2);
  dbError(rows.error);
  if ((rows.data?.length ?? 0) > 1)
    throw Error("Managed calendar owner limit exceeded");
  const results = [];
  for (const c of rows.data ?? []) {
    if (c.last_synced_at && Date.now() - Date.parse(c.last_synced_at) < 300000)
      continue;
    results.push(await syncCalendarForUser(c.user_id, c.id));
  }
  return results;
}
