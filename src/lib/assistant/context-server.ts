import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "../http";
import {
  academicContext,
  courseCode,
  plainStudyText,
  type AcademicCandidate,
} from "./academic-context";
import type { AssistantSource } from "./provider";
export async function assistantAcademicContext(
  db: SupabaseClient,
  user: string,
  question: string,
  previousQuestion: string,
  pinnedCourse: string | null,
) {
  const [courses, native, canvasCourses, assignments] = await Promise.all([
    db.from("courses").select("id,code,title").eq("user_id", user).limit(100),
    db
      .from("assessments")
      .select(
        "id,course_id,title,due_at,due_date,verification_status,source_key",
      )
      .eq("user_id", user)
      .eq("dropped", false)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(400),
    db
      .from("canvas_records")
      .select("canvas_id,payload,synced_at")
      .eq("user_id", user)
      .eq("resource_type", "course")
      .limit(100),
    db
      .from("canvas_records")
      .select("canvas_id,course_canvas_id,payload,synced_at")
      .eq("user_id", user)
      .eq("resource_type", "assignment")
      .order("canvas_id")
      .limit(400),
  ]);
  for (const r of [courses, native, canvasCourses, assignments])
    dbError(r.error);
  const candidates: AcademicCandidate[] = [];
  for (const a of assignments.data ?? []) {
    const c = canvasCourses.data?.find(
      (c) => c.canvas_id === a.course_canvas_id,
    );
    if (a.payload.published === false) continue;
    candidates.push({
      id: `canvas:assignment:${a.canvas_id}`,
      course_id: a.course_canvas_id,
      canvas_course: a.course_canvas_id,
      course:
        c?.payload.course_code ??
        c?.payload.name ??
        "Unidentified Canvas course",
      title: a.payload.name ?? "Untitled assessment",
      due_at: a.payload.due_at ?? null,
      description: plainStudyText(a.payload.description),
      verification: "Canvas-retrieved",
      synced_at: a.synced_at,
      url: `https://canvas.sfu.ca/courses/${a.course_canvas_id}/assignments/${a.payload.id}`,
    });
  }
  for (const a of native.data ?? []) {
    if (a.source_key?.startsWith("canvas:")) continue;
    const c = courses.data?.find((c) => c.id === a.course_id);
    candidates.push({
      id: `assessment:${a.id}`,
      course_id: a.course_id,
      course: c?.code ?? "Unidentified course",
      title: a.title,
      due_at: a.due_at,
      due_date: a.due_date,
      verification: a.verification_status,
      url: "/areas/academics",
    });
  }
  const result = academicContext(
    /\b(it|that|those|this exam|the exam)\b/i.test(question)
      ? question + " " + previousQuestion
      : question,
    candidates,
  );
  const sources: AssistantSource[] = [...result.sources];
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const explicit = canvasCourses.data?.find(
    (c) =>
      normal(question).includes(courseCode(c.payload.course_code ?? "")) &&
      courseCode(c.payload.course_code ?? "").length >= 4,
  );
  const course =
    explicit?.canvas_id ?? result.focus?.canvas_course ?? pinnedCourse;
  if (course) {
    const pages = await db
      .from("canvas_records")
      .select("resource_type,canvas_id,payload,synced_at")
      .eq("user_id", user)
      .eq("course_canvas_id", course)
      .in("resource_type", ["page_content", "module_item"])
      .order("synced_at", { ascending: false })
      .limit(100);
    dbError(pages.error);
    const terms =
      (question + " " + (result.focus?.title ?? ""))
        .toLowerCase()
        .match(/[a-z0-9]{4,}/g) ?? [];
    const ranked = (pages.data ?? [])
      .map((p) => ({
        p,
        score: terms.reduce(
          (n, t) =>
            n +
            (String(p.payload.title ?? "")
              .toLowerCase()
              .includes(t)
              ? 3
              : 0),
          0,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { p } of ranked.slice(0, 2)) {
      const text = plainStudyText(p.payload.body ?? p.payload.title, 900);
      if (text)
        sources.push({
          id: `canvas:${p.resource_type}:${p.canvas_id}`,
          title: plainStudyText(p.payload.title, 100),
          text,
          trust: "untrusted_course_content_not_complete_exam_scope",
          retrieved_at: p.synced_at,
          url: `https://canvas.sfu.ca/courses/${course}`,
        });
    }
  }
  return sources;
}
