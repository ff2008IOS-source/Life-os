import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const r = await db
      .from("focus_sessions")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["running", "paused"])
      .maybeSingle();
    dbError(r.error);
    return NextResponse.json(
      { session: r.data, server_time: new Date().toISOString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = z
      .object({
        action: z.enum(["start", "pause", "resume", "finish", "discard"]),
        session_id: z.uuid().nullable().default(null),
        version: z.number().int().positive().nullable().default(null),
        request_id: z.uuid(),
        task_id: z.uuid().nullable().default(null),
        actual_minutes: z
          .number()
          .int()
          .min(1)
          .max(1440)
          .nullable()
          .default(null),
        finish_task: z.boolean().default(false),
        notes: z.string().max(2000).default(""),
      })
      .strict()
      .parse(await readJson(request));
    if (x.action === "start" && process.env.LIFE_OS_DASHBOARD_V2 === "false")
      throw new ApiError(
        503,
        "New focus sessions are temporarily unavailable. Existing sessions can still be finished.",
        "FEATURE_DISABLED",
      );
    const r = await db.rpc("change_focus_session", {
      p_action: x.action,
      p_session: x.session_id,
      p_version: x.version,
      p_request: x.request_id,
      p_task: x.task_id,
      p_minutes: x.actual_minutes,
      p_finish: x.finish_task,
      p_notes: x.notes,
    });
    if (r.error?.code === "40001" || r.error?.code === "23505")
      throw new ApiError(
        409,
        "Your focus session changed. Reload it before continuing.",
        "VERSION_CONFLICT",
      );
    if (r.error?.code === "P0002")
      throw new ApiError(404, "That task or session is no longer available.");
    if (r.error?.code === "22023")
      throw new ApiError(
        422,
        "Check the session state and confirm your actual work details.",
      );
    dbError(r.error);
    return NextResponse.json({
      session: r.data,
      server_time: new Date().toISOString(),
    });
  } catch (e) {
    return failure(e);
  }
}
