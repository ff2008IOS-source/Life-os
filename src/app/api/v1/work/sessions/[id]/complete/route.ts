import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { workCompletionInput } from "@/lib/work-session";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const id = z.uuid().parse((await params).id);
    const x = workCompletionInput.parse(await readJson(request));
    const { data, error } = await db.rpc("complete_work_session", {
      p_block: id,
      p_version: x.version,
      p_request: x.request_id,
      p_minutes: x.actual_minutes,
      p_start: x.actual_start_at,
      p_end: x.actual_end_at,
      p_finish: x.finish_task,
      p_practiced: x.practiced_topic,
      p_notes: x.notes,
    });
    if (error?.code === "40001")
      throw new ApiError(
        409,
        "This session changed or was completed with different values. Refresh to review it.",
      );
    if (error?.code === "P0002") throw new ApiError(404, "Session not found.");
    if (error?.code === "42501")
      throw new ApiError(
        403,
        "You cannot change these recorded completion details.",
      );
    if (error?.code === "22023")
      throw new ApiError(
        422,
        "Check the actual minutes, timestamps, linked topic and task status. Recurring occurrences use their existing completion workflow.",
      );
    dbError(error);
    return NextResponse.json({ data });
  } catch (e) {
    return failure(e);
  }
}
