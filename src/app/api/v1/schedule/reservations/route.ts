import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, readJson, failure, dbError } from "@/lib/http";
import {
  setupDedicatedCalendar,
  applyReservations,
  undoReservations,
} from "@/lib/integrations/calendar-write-server";
export const maxDuration = 300;
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [calendars, runs] = await Promise.all([
      db
        .from("calendars")
        .select("id,name,connection_id")
        .eq("user_id", user.id)
        .eq("is_life_os_owned", true),
      db
        .from("scheduling_runs")
        .select("id,status,applied_count,started_at,error_summary")
        .eq("user_id", user.id)
        .in("status", ["completed", "failed", "applying"])
        .order("started_at", { ascending: false })
        .limit(10),
    ]);
    dbError(calendars.error);
    dbError(runs.error);
    return NextResponse.json({ calendars: calendars.data, runs: runs.data });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const input = z
      .discriminatedUnion("action", [
        z
          .object({ action: z.literal("setup"), connection_id: z.uuid() })
          .strict(),
        z.object({ action: z.literal("apply"), run_id: z.uuid() }).strict(),
        z.object({ action: z.literal("undo"), run_id: z.uuid() }).strict(),
      ])
      .parse(await readJson(request));
    return NextResponse.json(
      input.action === "setup"
        ? await setupDedicatedCalendar(input.connection_id)
        : input.action === "apply"
          ? await applyReservations(input.run_id)
          : await undoReservations(input.run_id),
    );
  } catch (e) {
    return failure(e);
  }
}
