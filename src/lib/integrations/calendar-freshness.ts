import { CALENDAR_FRESH_MS } from "@/lib/calendar-availability";
import "server-only";
import { randomUUID } from "node:crypto";
import { integrationAdmin } from "./google-server";
import { syncCalendarForUser } from "./calendar-sync-service";
import { dbError } from "../http";
/** A durable per-source bucket suppresses duplicate refresh work across tabs and instances. */
export async function refreshStaleCalendar(user: string, calendar: string) {
  const db = integrationAdmin();
  const source = await db
    .from("calendars")
    .select("last_synced_at,connection_id")
    .eq("user_id", user)
    .eq("id", calendar)
    .eq("sync_enabled", true)
    .maybeSingle();
  dbError(source.error);
  if (!source.data) return { skipped: "not_selected" };
  const account = await db
    .from("calendar_connections")
    .select("status,daily_sync_enabled")
    .eq("user_id", user)
    .eq("id", source.data.connection_id)
    .maybeSingle();
  dbError(account.error);
  if (account.data?.status !== "connected" || !account.data.daily_sync_enabled)
    return { skipped: "automatic_refresh_not_enabled" };
  if (
    source.data.last_synced_at &&
    Date.now() - Date.parse(source.data.last_synced_at) < CALENDAR_FRESH_MS
  )
    return { skipped: "fresh" };
  const job = await db
    .from("integration_jobs")
    .upsert(
      {
        user_id: user,
        job_type: "calendar_freshness_refresh",
        idempotency_key: `freshness:${calendar}:${Math.floor(Date.now() / CALENDAR_FRESH_MS)}`,
        status: "running",
        lease_token: randomUUID(),
        lease_until: new Date(Date.now() + 60000).toISOString(),
        payload: { calendar_id: calendar },
      },
      { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  dbError(job.error);
  if (!job.data) return { skipped: "refresh_already_requested" };
  try {
    const result = await syncCalendarForUser(user, calendar);
    const done = await db
      .from("integration_jobs")
      .update({ status: "completed", lease_until: null })
      .eq("user_id", user)
      .eq("id", job.data.id);
    dbError(done.error);
    return { refreshed: true, ...result };
  } catch (error) {
    // Free the bucket so the next visit retries instead of being skipped.
    await db
      .from("integration_jobs")
      .update({
        status: "failed",
        lease_until: null,
        idempotency_key: `freshness:${calendar}:failed:${randomUUID()}`,
        last_error: "Calendar refresh failed. Cached events retained.",
      })
      .eq("user_id", user)
      .eq("id", job.data.id);
    throw error;
  }
}
