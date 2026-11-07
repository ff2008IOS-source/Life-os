import { z } from "zod";
import type { CanvasRecord } from "./client";
const id = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform(String);
const text = (x: unknown) => (typeof x === "string" ? x : null);
const numeric = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
export type JobSpec = {
  key: string;
  type: string;
  path: string;
  params: Record<string, string | string[]>;
  course: string | null;
  single: boolean;
  minutes: number;
};
export function job(
  type: string,
  path: string,
  course: string | null = null,
  minutes = 60,
  params: JobSpec["params"] = {},
  single = false,
): JobSpec {
  return {
    key: type + ":" + path,
    type,
    path,
    course,
    minutes,
    params,
    single,
  };
}
export const coursesJob = () =>
  job("course", "courses", null, 1440, {
    enrollment_state: "active",
    "include[]": ["term", "syllabus_body", "total_scores"],
  });
export function resourceId(
  type: string,
  p: CanvasRecord,
  course: string | null,
) {
  if (type === "submission")
    return `${course}:${id.parse(p.assignment_id)}:${id.parse(p.user_id)}`;
  const raw =
    type === "page_content" || type === "page" ? (p.page_id ?? p.id) : p.id;
  if (
    type === "calendar_event" &&
    typeof raw === "string" &&
    /^(assignment_|calendar_event_)?\d+$/.test(raw)
  )
    return `${course}:${raw}`;
  const parsed = id.parse(raw);
  return course ? `${course}:${parsed}` : parsed;
}
export function normalized(
  type: string,
  p: CanvasRecord,
): Record<string, unknown> | null {
  if (type === "course") {
    const term = p.term as CanvasRecord | undefined;
    const code = text(p.course_code)
      ?.toUpperCase()
      .match(/\b[A-Z]{2,5}\s*\d{3}[A-Z]?\b/)?.[0];
    return {
      code: code ?? null,
      title: z.string().min(1).max(300).parse(p.name),
      term: text(term?.name),
    };
  }
  if (type === "assignment_group")
    return {
      name: z.string().min(1).max(300).parse(p.name),
      weight:
        p.group_weight == null
          ? null
          : z.number().min(0).max(100).parse(p.group_weight),
    };
  if (type !== "assignment") return null;
  const s = (p.submission ?? {}) as CanvasRecord;
  const max = numeric(p.points_possible),
    score = numeric(s.score);
  const earned =
    max !== null && max > 0 && score !== null && score >= 0 ? score : null;
  const due =
    p.due_at == null ? null : z.iso.datetime({ offset: true }).parse(p.due_at);
  return {
    title: z.string().min(1).max(300).parse(p.name),
    group_id:
      p.assignment_group_id == null ? null : id.parse(p.assignment_group_id),
    maximum_score: max !== null && max > 0 ? max : null,
    earned_score: earned,
    due_at: due,
    submission_state:
      s.excused === true
        ? "excused"
        : s.workflow_state === "graded"
          ? "returned"
          : s.submitted_at
            ? "submitted"
            : s.workflow_state === "unsubmitted"
              ? "not_submitted"
              : "unknown",
    url:
      typeof p.html_url === "string" &&
      p.html_url.startsWith("https://canvas.sfu.ca/")
        ? p.html_url
        : null,
  };
}
export function children(
  type: string,
  p: CanvasRecord,
  course: string | null,
): JobSpec[] {
  if (type === "course") {
    const c = id.parse(p.id),
      base = `courses/${c}`;
    return [
      job("assignment", `${base}/assignments`, c, 60, {
        "include[]": ["submission"],
      }),
      job("assignment_group", `${base}/assignment_groups`, c, 360),
      job("submission", `${base}/students/submissions`, c, 60, {
        "student_ids[]": "self",
        "include[]": "submission_comments",
      }),
      job("enrollment", `${base}/enrollments`, c, 60, { user_id: "self" }),
      job("module", `${base}/modules`, c, 360),
      job("page", `${base}/pages`, c, 360),
      job("file", `${base}/files`, c, 360),
      job("announcement", "announcements", c, 60, {
        "context_codes[]": `course_${c}`,
        start_date: "1970-01-01",
      }),
      job("calendar_event", "calendar_events", c, 60, {
        "context_codes[]": `course_${c}`,
        all_events: "true",
      }),
    ].map((j) => ({ ...j, key: j.key + ":" + c }));
  }
  if (type === "module" && course)
    return [
      job(
        "module_item",
        `courses/${course}/modules/${id.parse(p.id)}/items`,
        course,
        360,
      ),
    ];
  if (
    type === "page" &&
    course &&
    p.published === true &&
    typeof p.url === "string"
  )
    return [
      job(
        "page_content",
        `courses/${course}/pages/${encodeURIComponent(p.url)}`,
        course,
        360,
        {},
        true,
      ),
    ];
  return [];
}
export function expiryWarning(expires: string, now = Date.now()) {
  const days = Math.ceil((Date.parse(expires) - now) / 86400000);
  return days <= 0 ? 0 : days <= 1 ? 1 : days <= 3 ? 3 : days <= 7 ? 7 : null;
}
