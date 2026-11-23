import { z } from "zod";
import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const now = Date.now();
    // The course picker lists the courses that actually have Canvas deadlines.
    if (new URL(request.url).searchParams.get("courses") === "1") {
      const { data, error } = await db
        .from("canvas_deadlines")
        .select("course_code")
        .eq("user_id", user.id)
        .not("course_code", "is", null)
        .limit(5000);
      dbError(error);
      const courses = [
        ...new Set((data ?? []).map((r) => String(r.course_code).trim())),
      ]
        .filter(Boolean)
        .sort();
      return NextResponse.json({ courses });
    }
    const search = z
      .string()
      .trim()
      .max(150)
      .parse(new URL(request.url).searchParams.get("search") ?? "");
    const course = z
      .string()
      .trim()
      .max(100)
      .parse(new URL(request.url).searchParams.get("course") ?? "");
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
    if (search)
      query = query.ilike(
        "title",
        "%" + search.replace(/[\\%_]/g, "\\$&") + "%",
      );
    if (course) query = query.eq("course_code", course);
    if (view === "history")
      query = query
        .in("submission_state", ["submitted", "graded", "excused"])
        .order("due_at", { ascending: false });
    else {
      // Graded work belongs in results; a missing electronic-upload timestamp
      // does not make an in-person exam outstanding.
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
    const records = r.data?.slice(0, 6) ?? [];
    const grades = records.length
      ? await db
          .from("assessments")
          .select("source_key,earned_score,maximum_score,notes")
          .eq("user_id", user.id)
          .in(
            "source_key",
            records.map((row) => `canvas:${row.canvas_id}`),
          )
          .limit(50)
      : { data: [], error: null };
    dbError(grades.error);
    return NextResponse.json(
      {
        records: records.map((row) => {
          const matches =
            grades.data?.filter(
              (grade) => grade.source_key === `canvas:${row.canvas_id}`,
            ) ?? [];
          const grade = matches.length === 1 ? matches[0] : null;
          return {
            ...row,
            earned_score: grade?.earned_score ?? null,
            maximum_score: grade?.maximum_score ?? null,
          };
        }),
        view,
        has_more: (r.data?.length ?? 0) > 6,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
