import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, failure, dbError } from "@/lib/http";
import {
  googleConfig,
  integrationRpc,
  refreshGoogleCalendars,
  disconnectGoogle,
  integrationAdmin,
} from "@/lib/integrations/google-server";
export async function GET() {
  try {
    const { db, user } = await authorized();
    let configured = true;
    try {
      googleConfig();
    } catch {
      configured = false;
    }
    const [connections, calendars, runs] = await Promise.all([
      db
        .from("calendar_connections")
        .select("id,status,last_sync_at,daily_sync_enabled")
        .eq("user_id", user.id)
        .order("created_at"),
      db
        .from("calendars")
        .select(
          "id,connection_id,name,timezone,color,access_role,sync_enabled,last_synced_at,coverage_start,coverage_end,sync_error",
        )
        .eq("user_id", user.id)
        .order("name"),
      db
        .from("integration_jobs")
        .select("status,last_error,updated_at")
        .eq("user_id", user.id)
        .eq("job_type", "google_calendar_daily")
        .order("updated_at", { ascending: false })
        .limit(6),
    ]);
    dbError(connections.error);
    dbError(calendars.error);
    dbError(runs.error);
    return NextResponse.json({
      configured,
      connections: connections.data,
      calendars: calendars.data,
      daily_runs: runs.data,
      daily_sync_configured: !!process.env.CRON_SECRET,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user, db } = await authorized();
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("select"),
            calendar_id: z.uuid(),
            enabled: z.boolean(),
          })
          .strict(),
        z
          .object({
            action: z.literal("daily"),
            connection_id: z.uuid(),
            enabled: z.boolean(),
          })
          .strict(),
        z
          .object({ action: z.literal("refresh"), connection_id: z.uuid() })
          .strict(),
      ])
      .parse(await readJson(request));
    if (input.action === "daily") {
      const { data, error } = await integrationAdmin()
        .from("calendar_connections")
        .update({ daily_sync_enabled: input.enabled })
        .eq("user_id", user.id)
        .eq("id", input.connection_id)
        .eq("status", "connected")
        .select("id")
        .single();
      dbError(error);
      if (!data) throw Error("Connection missing");
      return NextResponse.json({ saved: true });
    }
    if (input.action === "select") {
      const { data, error } = await db
        .from("calendars")
        .select("id")
        .eq("id", input.calendar_id)
        .eq("user_id", user.id)
        .single();
      dbError(error);
      if (!data) throw Error("Calendar missing");
      await integrationRpc("google_select_calendar", {
        p_user: user.id,
        p_calendar: input.calendar_id,
        p_enabled: input.enabled,
      });
      return NextResponse.json({ saved: true });
    }
    return NextResponse.json({
      calendars: await refreshGoogleCalendars(input.connection_id),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkMutation(request);
    await authorized();
    const { connection_id } = z
      .object({ connection_id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    await disconnectGoogle(connection_id);
    return NextResponse.json({ disconnected: true });
  } catch (e) {
    return failure(e);
  }
}
