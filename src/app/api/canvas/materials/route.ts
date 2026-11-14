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
        local_course: z.uuid().nullable(),
        page: z.coerce.number().int().min(0).max(1000),
        context: z.boolean(),
        library: z.boolean(),
        syllabus: z.boolean(),
      })
      .parse({
        course: params.get("course"),
        local_course: params.get("local_course"),
        page: params.get("page") ?? 0,
        context: params.get("context") === "true",
        library: params.get("library") === "true",
        syllabus: params.get("syllabus") === "true",
      });
    const db = canvasAdmin();
    let resolvedCourse = input.course;
    if (input.local_course) {
      const mapping = await db
        .from("canvas_mappings")
        .select("canvas_id,conflict")
        .eq("user_id", user.id)
        .eq("resource_type", "course")
        .eq("local_table", "courses")
        .eq("local_id", input.local_course)
        .limit(2);
      dbError(mapping.error);
      if (mapping.data?.length !== 1 || mapping.data[0].conflict)
        return NextResponse.json(
          {
            courses: [],
            courses_truncated: false,
            has_more: false,
            records: [],
            mapping_status: !mapping.data?.length
              ? "unlinked"
              : mapping.data.length > 1
                ? "ambiguous"
                : "needs_review",
          },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      resolvedCourse = mapping.data[0].canvas_id;
    }
    if (input.context && resolvedCourse)
      return NextResponse.json(
        await canvasStudyContext(user.id, resolvedCourse),
        { headers: { "Cache-Control": "no-store" } },
      );
    const courses = await db
      .from("canvas_records")
      .select("canvas_id,payload,synced_at")
      .eq("user_id", user.id)
      .eq("resource_type", "course")
      .order("canvas_id")
      .limit(501);
    dbError(courses.error);
    const pageSize = input.library ? 999 : 30;
    let query = db
      .from("canvas_records")
      .select("resource_type,canvas_id,payload,synced_at,course_canvas_id")
      .eq("user_id", user.id)
      .order("resource_type")
      .order("canvas_id")
      .range(input.page * pageSize, input.page * pageSize + pageSize);
    if (input.local_course)
      query = query.in("resource_type", [
        "course",
        "module",
        "module_item",
        "page",
        "page_content",
        "file",
        "announcement",
      ]);
    if (resolvedCourse)
      query = query.or(
        `course_canvas_id.eq.${resolvedCourse},and(resource_type.eq.course,canvas_id.eq.${resolvedCourse})`,
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
          .limit(input.library ? 1000 : 31)
      : { data: [], error: null };
    const textIds = input.syllabus
      ? (rows.data ?? [])
          .filter(
            (r) =>
              r.resource_type === "file" &&
              /syllabus|outline/i.test(
                String(
                  r.payload.display_name ??
                    r.payload.filename ??
                    r.payload.title ??
                    "",
                ),
              ),
          )
          .map((r) => String(r.payload.id))
      : ids;
    let textQuery = db
      .from("canvas_document_chunks")
      .select("canvas_file_id,course_canvas_id,text,chunk_index")
      .eq("user_id", user.id)
      .in("canvas_file_id", textIds)
      .order("chunk_index")
      .limit(input.syllabus || input.library ? 1000 : 31);
    textQuery = input.syllabus
      ? textQuery.lt("chunk_index", 8)
      : textQuery.eq("chunk_index", 0);
    const chunks = textIds.length ? await textQuery : { data: [], error: null };
    dbError(docs.error);
    dbError(chunks.error);
    return NextResponse.json(
      {
        mapped_course: resolvedCourse,
        mapping_status: resolvedCourse ? "linked" : "library",
        courses: courses.data?.slice(0, 500).map((r) => ({
          id: r.canvas_id,
          name: plainCanvasText(r.payload.name, 300),
        })),
        courses_truncated: (courses.data?.length ?? 0) > 500,
        has_more: (rows.data?.length ?? 0) > pageSize,
        library_limited: input.library && (rows.data?.length ?? 0) >= 1000,
        records: rows.data?.slice(0, pageSize).map((r) => ({
          module: (() => {
            const item = rows.data?.find(
              (m) =>
                m.resource_type === "module_item" &&
                m.course_canvas_id === r.course_canvas_id &&
                String(m.payload.content_id) ===
                  String(r.payload.id ?? r.payload.page_id) &&
                String(m.payload.type ?? "").toLowerCase() ===
                  (r.resource_type === "page_content"
                    ? "page"
                    : r.resource_type),
            );
            const parentModule =
              item &&
              rows.data?.find(
                (m) =>
                  m.resource_type === "module" &&
                  m.course_canvas_id === r.course_canvas_id &&
                  String(m.payload.id) === String(item.payload.module_id),
              );
            return parentModule
              ? plainCanvasText(parentModule.payload.name, 300)
              : null;
          })(),
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
              ? (chunks.data
                  ?.filter(
                    (c) =>
                      c.canvas_file_id === String(r.payload.id) &&
                      c.course_canvas_id === r.course_canvas_id,
                  )
                  .map((c) => c.text)
                  .join(" ")
                  .slice(0, 20000) ?? "")
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
                    ? `${d.state}${d.pages && !String(r.payload["content-type"] ?? "").includes("wordprocessingml") ? ` · ${d.pages} ${String(r.payload["content-type"] ?? "").includes("presentationml") ? "slides" : "pages"}` : ""}${d.truncated ? " · partial extraction" : ""}${d.last_error ? ` · ${d.last_error}` : ""}`
                    : "File text not extracted yet";
                })()
              : "Retrieved Canvas record",
          url:
            r.course_canvas_id && /^\d+$/.test(r.course_canvas_id)
              ? `https://canvas.sfu.ca/courses/${r.course_canvas_id}${r.resource_type === "file" && /^\d+$/.test(String(r.payload.id)) ? `/files/${r.payload.id}` : r.resource_type === "assignment" && /^\d+$/.test(String(r.payload.id)) ? `/assignments/${r.payload.id}` : ""}`
              : "https://canvas.sfu.ca",
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
