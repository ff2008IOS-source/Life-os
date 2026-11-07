import { NextResponse } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { addDays, format } from "date-fns";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
import { localDate, TIMEZONE } from "@/lib/dates";
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const p = new URL(request.url).searchParams;
    const today = new Date(localDate() + "T12:00:00Z");
    const input = z
      .object({
        start: z.iso.date(),
        end: z.iso.date(),
        page: z.coerce.number().int().min(0).max(1000),
      })
      .refine(
        (x) =>
          x.end > x.start &&
          Date.parse(x.end) - Date.parse(x.start) <= 366 * 86400000,
      )
      .parse({
        start: p.get("start") ?? format(addDays(today, -6), "yyyy-MM-dd"),
        end: p.get("end") ?? format(addDays(today, 1), "yyyy-MM-dd"),
        page: p.get("page") ?? 0,
      });
    const start = fromZonedTime(
        input.start + "T00:00:00",
        TIMEZONE,
      ).toISOString(),
      end = fromZonedTime(input.end + "T00:00:00", TIMEZONE).toISOString();
    const [blocks, completions, summary] = await Promise.all([
      db
        .from("work_blocks")
        .select("id,task_id,start_at,end_at,status,version,provider_event_id")
        .eq("user_id", user.id)
        .eq("status", "planned")
        .order("start_at")
        .order("id")
        .range(input.page * 20, input.page * 20 + 20),
      db
        .from("work_completions")
        .select(
          "id,task_id,course_id,topic_id,actual_minutes,actual_start_at,actual_end_at,practiced_topic,task_completed,notes,reported_at",
        )
        .eq("user_id", user.id)
        .gte("reported_at", start)
        .lt("reported_at", end)
        .order("reported_at", { ascending: false })
        .limit(8),
      db.rpc("work_progress_summary", { p_start: start, p_end: end }),
    ]);
    dbError(blocks.error);
    dbError(completions.error);
    dbError(summary.error);
    return NextResponse.json({
      blocks: (blocks.data ?? []).slice(0, 20),
      has_more: (blocks.data?.length ?? 0) > 20,
      completions: completions.data ?? [],
      summary: summary.data,
      page: input.page,
      period: { start: input.start, end: input.end },
    });
  } catch (e) {
    return failure(e);
  }
}
