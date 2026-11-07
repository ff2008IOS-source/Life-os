import type { AssistantSource } from "./provider";
import { localDate, deadlineInstant } from "../dates";
export type AcademicCandidate = {
  id: string;
  course_id: string;
  course: string;
  title: string;
  due_at: string | null;
  due_date?: string | null;
  description?: string;
  verification: string;
  synced_at?: string;
  url: string;
  canvas_course?: string;
};
export function courseCode(value: string) {
  return (
    value.match(/[a-z]{2,5}\s*\d{3}(?:[a-z](?=\b|[\s-]))?/i)?.[0] ?? value
  )
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
const exam = /\b(exam(?:ination)?\s*\d*|test\s*\d*|midterm)\b|^\s*final\s*$/i;
export function plainStudyText(value: unknown, limit = 1000) {
  return typeof value === "string"
    ? value
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}
/** Select across every loaded course before fitting relevant excerpts into the provider budget. */
export function academicContext(
  question: string,
  candidates: AcademicCandidate[],
  now = new Date(),
) {
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mentioned = candidates.find(
    (a) =>
      compact(question).includes(courseCode(a.course)) &&
      courseCode(a.course).length >= 4,
  )?.course;
  const instant = (a: AcademicCandidate) =>
    deadlineInstant({ due_at: a.due_at, due_date: a.due_date ?? null });
  const unique = new Map<string, AcademicCandidate>();
  for (const a of candidates) {
    if (a.title.startsWith("[TEST]")) continue;
    const key = a.id;
    const prev = unique.get(key);
    if (!prev || a.verification === "Canvas-retrieved") unique.set(key, a);
  }
  const all = [...unique.values()];
  const upcoming = all
    .filter((a) => {
      const d = instant(a);
      return d && (a.due_date ? a.due_date >= localDate(now) : d >= now);
    })
    .sort((a, b) => instant(a)!.getTime() - instant(b)!.getTime());
  const wantsExam = /\b(exam|examination|test|midterm|final)\b/i.test(question);
  const matching = upcoming.filter(
    (a) =>
      (!mentioned || courseCode(a.course) === courseCode(mentioned)) &&
      (!wantsExam || exam.test(a.title)),
  );
  const focus = matching[0];
  const unknown = all.filter(
    (a) => !a.due_at && !a.due_date && (!wantsExam || exam.test(a.title)),
  ).length;
  const overview: AssistantSource = {
    id: "academics:upcoming",
    title: "Upcoming assessments across saved courses",
    url: "/canvas-materials",
    trust: "mixed_provenance_dates_not_completion",
    text: JSON.stringify({
      as_of: now.toISOString(),
      timezone: "America/Vancouver",
      searched_course_count: new Set(all.map((a) => a.course)).size,
      loaded_records: all.length,
      unknown_deadlines: unknown,
      upcoming: matching.slice(0, 4).map((a) => ({
        course: a.course,
        title: a.title,
        due: a.due_at ?? a.due_date,
        source: a.verification,
      })),
      unknown_date_assessments: all
        .filter(
          (a) => !a.due_at && !a.due_date && (!wantsExam || exam.test(a.title)),
        )
        .slice(0, 2)
        .map((a) => ({ course: a.course, title: a.title })),
      coverage:
        "Saved data only; missing dates and stale imports can hide other assessments. Exam scope must be explicitly stated in source material, never inferred from all course topics.",
    }),
  };
  const sources: AssistantSource[] = [overview];
  for (const a of matching.slice(0, 2))
    sources.push({
      id: a.id,
      title: `${a.course} · ${a.title}`,
      url: a.url,
      trust: a.verification,
      retrieved_at: a.synced_at,
      text: JSON.stringify({
        course: a.course,
        title: a.title,
        due_at: a.due_at,
        due_date: a.due_date ?? null,
        description: plainStudyText(a.description, 1000),
        verification: a.verification,
      }),
    });
  return { sources, focus, upcoming, unknown_deadlines: unknown };
}

/** Prevent academic context from crowding out a career question (and vice versa). */
export function prioritizeAssistantSources(
  question: string,
  sources: AssistantSource[],
) {
  const academic =
    /\b(exam|test|study|course|lecture|syllabus|assessment|assignment|reading|grade|midterm|final)\b/i.test(
      question,
    );
  const career =
    /\b(career|project|portfolio|goal|network|internship|milestone)\b/i.test(
      question,
    );
  const score = (s: AssistantSource) => {
    if (s.id.startsWith("history:")) return 75;
    if (s.id === "academics:upcoming")
      return academic ? 120 : career ? 20 : 100;
    if (s.id.startsWith("canvas:assignment:") || s.id.startsWith("assessment:"))
      return academic ? 110 : career ? 10 : 90;
    if (s.id.startsWith("canvas:")) return academic ? 105 : 15;
    if (s.id.startsWith("project:") || s.id.startsWith("goal:"))
      return career ? 120 : 40;
    return 70;
  };
  return sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => score(b.source) - score(a.source) || a.index - b.index)
    .map((x) => x.source);
}
