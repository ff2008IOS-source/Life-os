import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
import { canvasAdmin } from "@/lib/canvas/secure";
import {
  canvasStudyContext,
  plainCanvasText,
} from "@/lib/canvas/study-context";
export async function GET(request: Request) {
  try {
    const { user } = await authorized();
    const params = new URL(request.url).searchParams;
    const input = z
      .object({
        course: z.string().regex(/^\d+$/).nullable(),
        page: z.coerce.number().int().min(0).max(1000),
        context: z.boolean(),
      })
      .parse({
        course: params.get("course"),
        page: params.get("page") ?? 0,
        context: params.get("context") === "true",
      });
    if (input.context && input.course)
      return NextResponse.json(
        await canvasStudyContext(user.id, input.course),
        { headers: { "Cache-Control": "no-store" } },
      );
    const db = canvasAdmin();
    const courses = await db
      .from("canvas_records")
      .select("canvas_id,payload,synced_at")
      .eq("user_id", user.id)
      .eq("resource_type", "course")
      .order("canvas_id")
      .limit(501);
    dbError(courses.error);
    let query = db
      .from("canvas_records")
      .select("resource_type,canvas_id,payload,synced_at,course_canvas_id")
      .eq("user_id", user.id)
      .order("resource_type")
      .order("canvas_id")
      .range(input.page * 30, input.page * 30 + 30);
    if (input.course)
      query = query.or(
        `course_canvas_id.eq.${input.course},and(resource_type.eq.course,canvas_id.eq.${input.course})`,
      );
    const rows = await query;
    dbError(rows.error);
    const ids = (rows.data ?? [])
      .filter((r) => r.resource_type === "file")
      .map((r) => String(r.payload.id));
    const docs = ids.length
      ? await db
          .from("canvas_documents")
          .select(
            "canvas_file_id,course_canvas_id,state,pages,truncated,extracted_at,last_error",
          )
          .eq("user_id", user.id)
          .in("canvas_file_id", ids)
          .limit(31)
      : { data: [], error: null };
    const chunks = ids.length
      ? await db
          .from("canvas_document_chunks")
          .select("canvas_file_id,course_canvas_id,text")
          .eq("user_id", user.id)
          .eq("chunk_index", 0)
          .in("canvas_file_id", ids)
          .limit(31)
      : { data: [], error: null };
    dbError(docs.error);
    dbError(chunks.error);
    return NextResponse.json(
      {
        courses: courses.data?.slice(0, 500).map((r) => ({
          id: r.canvas_id,
          name: plainCanvasText(r.payload.name, 300),
        })),
        courses_truncated: (courses.data?.length ?? 0) > 500,
        has_more: (rows.data?.length ?? 0) > 30,
        records: rows.data?.slice(0, 30).map((r) => ({
          id: r.canvas_id,
          type: r.resource_type,
          course: r.course_canvas_id,
          title: plainCanvasText(
            r.payload.title ??
              r.payload.name ??
              r.payload.display_name ??
              r.payload.filename ??
              r.resource_type,
            300,
          ),
          text:
            r.resource_type === "file"
              ? (chunks.data?.find(
                  (c) =>
                    c.canvas_file_id === String(r.payload.id) &&
                    c.course_canvas_id === r.course_canvas_id,
                )?.text ?? "")
              : plainCanvasText(
                  r.payload.body ??
                    r.payload.description ??
                    r.payload.syllabus_body,
                ),
          due_at: r.payload.due_at ?? null,
          score: r.payload.submission?.score ?? r.payload.score ?? null,
          maximum: r.payload.points_possible ?? null,
          state:
            r.payload.submission?.workflow_state ??
            r.payload.workflow_state ??
            null,
          synced_at: r.synced_at,
          facts: Object.fromEntries(
            [
              "course_code",
              "published",
              "submission_types",
              "unlock_at",
              "lock_at",
              "assignment_group_id",
              "group_weight",
              "rules",
              "late",
              "missing",
              "excused",
              "submitted_at",
              "grade",
              "submission_comments",
              "enrollments",
              "grades",
              "term",
            ]
              .filter((k) => r.payload[k] !== undefined)
              .map((k) => [k, JSON.stringify(r.payload[k]).slice(0, 3000)]),
          ),
          content_status:
            r.resource_type === "file"
              ? (() => {
                  const d = docs.data?.find(
                    (d) =>
                      d.canvas_file_id === String(r.payload.id) &&
                      d.course_canvas_id === r.course_canvas_id,
                  );
                  return d
                    ? `${d.state}${d.pages ? ` · ${d.pages} pages/slides` : ""}${d.truncated ? " · partial extraction" : ""}${d.last_error ? ` · ${d.last_error}` : ""}`
                    : "File text not extracted yet";
                })()
              : "Retrieved Canvas record",
          url: r.course_canvas_id
            ? `https://canvas.sfu.ca/courses/${r.course_canvas_id}`
            : "https://canvas.sfu.ca",
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
