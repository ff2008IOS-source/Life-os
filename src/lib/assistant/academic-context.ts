import type { AssistantSource } from "./provider";
import { formatInTimeZone } from "date-fns-tz";
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
  const wantsMidterm = /\bmidterm\b/i.test(question);
  const wantsFinal = /\bfinal\b/i.test(question);
  const realExam = (a: AcademicCandidate) =>
    exam.test(a.title) && !/\b(practice|sample|makeups?|mock)\b/i.test(a.title);
  const matching = upcoming.filter(
    (a) =>
      (!mentioned || courseCode(a.course) === courseCode(mentioned)) &&
      (!wantsExam || realExam(a)) &&
      (!wantsMidterm ||
        /\bmidterm\b/i.test(a.title + " " + (a.description ?? ""))) &&
      (!wantsFinal || /\bfinal\b/i.test(a.title)),
  );
  const focus = matching[0];
  const tentative =
    !focus && wantsMidterm
      ? upcoming
          .filter(
            (a) =>
              realExam(a) &&
              /\bexam/i.test(a.title) &&
              (!mentioned || courseCode(a.course) === courseCode(mentioned)),
          )
          .slice(0, 1)
      : [];
  const materialFocus = focus ?? tentative[0];
  const unknown = all.filter(
    (a) => !a.due_at && !a.due_date && (!wantsExam || realExam(a)),
  ).length;
  const sources: AssistantSource[] = [];
  const overview: AssistantSource = {
    id: "academics:upcoming",
    title: "Assessment lookup and uncertainty",
    url: "/canvas-materials",
    trust: "mixed_provenance_dates_not_completion",
    text: JSON.stringify({
      as_of: formatInTimeZone(
        now,
        "America/Vancouver",
        "EEE, MMM d, yyyy, h:mm a zzz",
      ),
      timezone: "America/Vancouver",
      searched_course_count: new Set(all.map((a) => courseCode(a.course))).size,
      unknown_deadlines: unknown,
      explicit_midterm_identified: wantsMidterm ? !!focus : undefined,
      rule:
        !focus && wantsMidterm
          ? "No explicitly identified dated midterm was found. Any Exam record below is only a candidate, NOT a confirmed midterm."
          : "Use source verification labels. A deadline is NOT an exam start time. Missing dates prevent a definitive claim about the actual next exam.",
      coverage:
        "Partial saved records; exam scope must be explicit, never inferred from all course topics.",
    }),
  };
  sources.push(overview);
  for (const a of [...matching.slice(0, 1), ...tentative])
    sources.push({
      id: a.id,
      title: a.course + " · " + a.title,
      url: a.url,
      trust: a.verification,
      retrieved_at: a.synced_at,
      text: JSON.stringify({
        course: a.course,
        title: a.title,
        deadline_iso: a.due_at ? localDate(a.due_at) : (a.due_date ?? null),
        deadline_local: a.due_at
          ? formatInTimeZone(
              a.due_at,
              "America/Vancouver",
              "EEEE, MMM d, yyyy 'at' h:mm a zzz",
            )
          : a.due_date
            ? formatInTimeZone(
                new Date(a.due_date + "T12:00:00Z"),
                "UTC",
                "EEEE, MMM d, yyyy",
              ) + " (date only; time unknown)"
            : null,
        deadline_kind: "Due deadline, not necessarily exam start",
        description: plainStudyText(a.description, 1000),
        verification:
          a.verification === "Canvas-retrieved"
            ? "Canvas-retrieved; check last sync"
            : a.verification === "unverified"
              ? "UNVERIFIED imported record; tentative, requires confirmation"
              : a.verification,
        midterm_confirmed: wantsMidterm ? !!focus : undefined,
      }),
    });

  return {
    sources,
    focus,
    materialFocus,
    upcoming,
    unknown_deadlines: unknown,
  };
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
    if (s.id.startsWith("review:saved:")) return 135;
    if (s.id.startsWith("history:")) return 75;
    if (s.id === "academics:upcoming")
      return academic ? 130 : career ? 20 : 100;
    if (s.id.startsWith("canvas:assignment:") || s.id.startsWith("assessment:"))
      return academic ? 125 : career ? 10 : 90;
    if (s.id.startsWith("canvas:document:")) return academic ? 120 : 20;
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
/** Carry only the most recent explicitly mentioned course into an academic follow-up.
 * Never treat earlier AI wording as a verified course fact or pin a global question. */
export function conversationQuestion(
  question: string,
  previousQuestions: string,
  courses: string[],
) {
  const mentions = (text: string, course: string) =>
    courseCode(course).length >= 4 &&
    text
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .includes(courseCode(course));
  if (
    courses.some((c) => mentions(question, c)) ||
    /\b(all (?:my )?courses|across (?:my |all )?courses|overall|new topic|different course)\b/i.test(
      question,
    )
  )
    return question;
  if (
    !/\b(exams?|midterms?|tests?|quizzes?|assignments?|study|teach|explain|chapters?|topics?|it|that|those|this|yes|more|continue|examples?|why)\b/i.test(
      question,
    )
  )
    return question;
  for (const previous of previousQuestions.split("\n").slice(0, 6)) {
    const matched = courses.filter((c) => mentions(previous, c));
    if (matched.length === 1)
      return question + " [Conversation course: " + matched[0] + "]";
    if (matched.length > 1) return question; // A cross-course comparison does not establish a single focus.
  }
  return question;
}
