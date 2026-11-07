import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "../http";
import {
  academicContext,
  conversationQuestion,
  courseCode,
  plainStudyText,
  type AcademicCandidate,
} from "./academic-context";
import { ensureCanvasDocument } from "../canvas/documents-server";
import { materialRelevance } from "./material-search";
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
  const selectionQuestion = conversationQuestion(question, previousQuestion, [
    ...new Set(
      [
        ...(courses.data ?? []).map((c) => c.code),
        ...(canvasCourses.data ?? []).map((c) => c.payload.course_code ?? ""),
      ].map(courseCode),
    ),
  ]);
  const result = academicContext(selectionQuestion, candidates);
  const sources: AssistantSource[] = [...result.sources];
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const explicit = canvasCourses.data?.find(
    (c) =>
      normal(selectionQuestion).includes(
        courseCode(c.payload.course_code ?? ""),
      ) && courseCode(c.payload.course_code ?? "").length >= 4,
  );
  const focus = result.materialFocus;
  const linked = focus
    ? canvasCourses.data?.find(
        (c) =>
          courseCode(c.payload.course_code ?? "") === courseCode(focus.course),
      )
    : null;
  const course =
    explicit?.canvas_id ??
    focus?.canvas_course ??
    linked?.canvas_id ??
    pinnedCourse;
  if (
    course &&
    (/\b(exam|midterm|test|study|topics|chapter|syllabus|material|lecture|reading|quiz|assessment)\b/i.test(
      question + " " + previousQuestion,
    ) ||
      explicit)
  ) {
    let extraction = "available";
    try {
      await ensureCanvasDocument(user, course, question, focus?.title ?? "");
    } catch {
      extraction =
        "File extraction could not complete; existing material remains available.";
    }
    const terms = (
      question +
      " " +
      (focus?.title ?? "") +
      " exam midterm syllabus chapters"
    )
      .toLowerCase()
      .match(/[a-z0-9]{2,}/g)
      ?.filter(
        (word) =>
          ![
            "what",
            "next",
            "hello",
            "about",
            "topics",
            "need",
            "should",
            "please",
            "the",
            "are",
            "on",
            "my",
            "do",
            "to",
            "yes",
            "that",
            "for",
          ].includes(word),
      )
      .slice(0, 18) ?? ["exam"];
    const found = await db.rpc("canvas_search_materials", {
      p_course: course,
      p_query: [...new Set(terms)].join(" OR "),
    });
    dbError(found.error);
    for (const document of found.data ?? [])
      sources.push({
        id: `canvas:document:${course}:${document.file_id}:${document.page}:${document.chunk_index}`,
        title: `${document.title} · ${/\.pdf$/i.test(document.title) ? `page ${document.page}` : /\.pptx$/i.test(document.title) ? `slide ${document.page}` : "retrieved text"}`,
        text: JSON.stringify({
          excerpt: document.text,
          coverage: /answer|solution|practice|20(?:0\d|1\d|2[0-5])/i.test(
            document.title,
          )
            ? "Historical/practice material; does not prove current exam scope"
            : "Retrieved file text; exact current exam scope must be stated explicitly",
          truncated: document.truncated,
        }),
        trust: "untrusted_extracted_document_text",
        retrieved_at: document.extracted_at,
        url: `https://canvas.sfu.ca/courses/${course}/files/${document.file_id}`,
      });

    const [pages, modules, announcements] = await Promise.all(
      ["page_content", "module_item", "announcement"].map((type) =>
        db
          .from("canvas_records")
          .select("resource_type,canvas_id,payload,synced_at")
          .eq("user_id", user)
          .eq("course_canvas_id", course)
          .eq("resource_type", type)
          .order("synced_at", { ascending: false })
          .limit(200),
      ),
    );
    for (const r of [pages, modules, announcements]) dbError(r.error);
    const syllabus = canvasCourses.data?.find((c) => c.canvas_id === course);
    const records = [
      ...(pages.data ?? []),
      ...(announcements.data ?? []),
      ...(syllabus?.payload.syllabus_body
        ? [
            {
              resource_type: "course",
              canvas_id: course,
              payload: {
                title: "Course syllabus",
                body: syllabus.payload.syllabus_body,
              },
              synced_at: syllabus.synced_at,
            },
          ]
        : []),
    ];
    const ranked = records
      .map((p) => ({
        p,
        ...materialRelevance(
          p.payload.title ?? p.payload.name ?? "",
          p.payload.body ?? p.payload.message ?? "",
          question,
          focus?.title ?? "",
        ),
      }))
      .filter((x) => x.score > 0 && x.excerpt)
      .sort((a, b) => b.score - a.score);
    for (const { p, excerpt } of ranked.slice(0, 3))
      sources.push({
        id: `canvas:${p.resource_type}:${p.canvas_id}`,
        title: plainStudyText(p.payload.title ?? p.payload.name, 100),
        text: excerpt,
        trust: "Source excerpt; only explicit exam scope is authoritative",
        retrieved_at: p.synced_at,
        url: `https://canvas.sfu.ca/courses/${course}`,
      });
    sources.push({
      id: "academics:retrieval",
      title: "Material search coverage",
      url: `https://canvas.sfu.ca/courses/${course}`,
      trust: "retrieval_report_not_exam_scope",
      text: JSON.stringify({
        course,
        body_records_checked: records.length,
        module_titles_checked: modules.data?.length ?? 0,
        matched_excerpts: ranked.length,
        extraction,
        extracted_chunks_found: found.data?.length ?? 0,
        files:
          "Accessible supported files are extracted in bounded batches; scanned, denied or oversized files may remain unavailable.",
        coverage:
          "Bounded search of saved pages, announcements and available syllabus. Do not claim no material exists; retrieval may be incomplete.",
        available_page_titles: records
          .map((p) => p.payload.title ?? p.payload.name)
          .slice(0, 12),
        linked_module_titles: (modules.data ?? [])
          .map((p) => p.payload.title)
          .filter((t) => /exam|midterm|review|syllabus/i.test(t ?? ""))
          .slice(0, 5),
      }),
    });
  }
  return sources;
}
