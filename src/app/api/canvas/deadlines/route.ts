import { z } from "zod";
import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const now = Date.now();
    const view = z
      .enum(["upcoming", "attention", "history"])
      .parse(new URL(request.url).searchParams.get("view") ?? "upcoming");
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000)
      .parse(new URL(request.url).searchParams.get("page") ?? 0);
    let query = db
      .from("canvas_deadlines")
      .select(
        "canvas_id,course_canvas_id,title,due_at,synced_at,conflict,task_id,course_code,submission_state,submission_synced_at,late",
      )
      .eq("user_id", user.id)
      .or("published.is.null,published.eq.true");
    if (view === "history")
      query = query
        .in("submission_state", ["submitted", "graded", "excused"])
        .order("due_at", { ascending: false });
    else {
      query = query.not("submission_state", "in", "(submitted,graded,excused)");
      if (view === "upcoming")
        query = query
          .gte("due_at", new Date(now).toISOString())
          .lt("due_at", new Date(now + 30 * 86400000).toISOString());
      else query = query.lt("due_at", new Date(now).toISOString());
      query = query.order("due_at", { ascending: view === "upcoming" });
    }
    const r = await query.order("canvas_id").range(page * 6, page * 6 + 6);
    dbError(r.error);
    return NextResponse.json(
      {
        records: r.data?.slice(0, 6) ?? [],
        view,
        has_more: (r.data?.length ?? 0) > 6,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
