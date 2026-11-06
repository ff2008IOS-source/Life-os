import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/auth";
import { localDate } from "@/lib/dates";
import { dbError, failure } from "@/lib/http";
import { integrationAdmin } from "@/lib/integrations/google-server";
import { syncCalendarForUser } from "@/lib/integrations/calendar-sync-service";
import { validCronSecret, runDailyWork } from "@/lib/integrations/daily-sync";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (
    !validCronSecret(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  )
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 },
    );
  try {
    const db = integrationAdmin();
    const { data: connections, error } = await db
      .from("calendar_connections")
      .select("id,user_id")
      .eq("status", "connected")
      .eq("daily_sync_enabled", true);
    dbError(error);
    const allowed: string[] = [];
    for (const userId of new Set((connections ?? []).map((c) => c.user_id))) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (
        !error &&
        data.user?.email?.toLowerCase() ===
          process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
      )
        allowed.push(userId);
    }
    const active = (connections ?? []).filter((c) =>
      allowed.includes(c.user_id),
    );
    if (!active.length)
      return NextResponse.json({
        completed: 0,
        failed: 0,
        skipped: 0,
        deferred: 0,
      });
    const rows = await db
      .from("calendars")
      .select("id,user_id,connection_id")
      .in(
        "connection_id",
        active.map((c) => c.id),
      )
      .eq("sync_enabled", true)
      .order("last_synced_at", { ascending: true, nullsFirst: true });
    dbError(rows.error);
    const day = localDate();
    const summary = await runDailyWork(rows.data ?? [], async (calendar) => {
      // One durable job per calendar/local day; duplicates and concurrent invocations
      // cannot both claim it. Failed or abandoned jobs can be retried manually.
      const key = `google:daily:${day}:${calendar.id}`;
      const lease = randomUUID();
      const until = new Date(Date.now() + 300000).toISOString();
      const inserted = await db
        .from("integration_jobs")
        .insert({
          user_id: calendar.user_id,
          connection_id: calendar.connection_id,
          job_type: "google_calendar_daily",
          idempotency_key: key,
          payload: { calendar_id: calendar.id, read_only: true },
          status: "running",
          attempts: 1,
          lease_token: lease,
          lease_until: until,
        })
        .select("id,attempts,version")
        .single();
      let job = inserted.data;
      if (inserted.error?.code === "23505") {
        const found = await db
          .from("integration_jobs")
          .select("id,status,attempts,version,lease_until")
          .eq("user_id", calendar.user_id)
          .eq("idempotency_key", key)
          .single();
        dbError(found.error);
        if (
          !found.data ||
          found.data.status === "completed" ||
          (found.data.status === "running" &&
            found.data.lease_until &&
            new Date(found.data.lease_until).getTime() > Date.now())
        )
          return "skipped";
        const claimed = await db
          .from("integration_jobs")
          .update({
            status: "running",
            attempts: found.data.attempts + 1,
            lease_token: lease,
            lease_until: until,
            last_error: null,
          })
          .eq("id", found.data.id)
          .eq("user_id", calendar.user_id)
          .eq("version", found.data.version)
          .select("id,attempts,version")
          .maybeSingle();
        dbError(claimed.error);
        if (!claimed.data) return "skipped";
        job = claimed.data;
      } else dbError(inserted.error);
      if (!job) throw Error("Job claim failed");
      try {
        // Re-check opt-in immediately before fetching provider events.
        const setting = await db
          .from("calendar_connections")
          .select("daily_sync_enabled,status")
          .eq("id", calendar.connection_id)
          .eq("user_id", calendar.user_id)
          .single();
        dbError(setting.error);
        if (
          !setting.data?.daily_sync_enabled ||
          setting.data.status !== "connected"
        ) {
          const cancelled = await db
            .from("integration_jobs")
            .update({
              status: "cancelled",
              lease_until: null,
              lease_token: null,
            })
            .eq("id", job.id)
            .eq("lease_token", lease);
          dbError(cancelled.error);
          return "skipped";
        }
        await syncCalendarForUser(calendar.user_id, calendar.id);
        const saved = await db
          .from("integration_jobs")
          .update({
            status: "completed",
            lease_until: null,
            lease_token: null,
            last_error: null,
          })
          .eq("id", job.id)
          .eq("lease_token", lease);
        dbError(saved.error);
        return "completed";
      } catch (error) {
        const result = await db
          .from("integration_jobs")
          .update({
            status: "failed",
            lease_until: null,
            lease_token: null,
            last_error:
              error instanceof ApiError
                ? error.message
                : "Daily read-only refresh failed. Use manual sync or reconnect Google.",
          })
          .eq("id", job.id)
          .eq("lease_token", lease);
        dbError(result.error);
        throw error;
      }
    });
    console.info("Daily Calendar refresh", summary);
    return NextResponse.json(summary, {
      status: summary.failed || summary.deferred ? 503 : 200,
    });
  } catch (error) {
    return failure(error);
  }
}
