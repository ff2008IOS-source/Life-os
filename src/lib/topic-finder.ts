import { z } from "zod";

/**
 * Study topics found in course materials. Everything here is pure so it can
 * be tested: normalising titles, removing duplicates, a heading-based
 * fallback when no AI is available, and the evidence rules that move a
 * topic's status.
 */

export const topicReply = z
  .object({
    topics: z
      .array(
        z
          .object({
            title: z.string().min(3).max(120),
            section: z.string().max(80),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type FoundTopic = { title: string; section: string };

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "to",
  "in",
  "for",
  "on",
  "vs",
]);
export function normalizeTopic(title: string) {
  return title
    .toLowerCase()
    .replace(
      /^(chapter|ch\.?|lecture|module|unit|week|topic)\s*\d+[a-z]?\s*[:.\-–—]?\s*/i,
      "",
    )
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

/** Keep candidates that aren't already a topic (or each other). */
export function dedupeTopics(candidates: FoundTopic[], existing: string[]) {
  const seen = existing.map(normalizeTopic).filter(Boolean);
  const out: FoundTopic[] = [];
  for (const c of candidates) {
    const title = c.title.replace(/\s+/g, " ").trim();
    const n = normalizeTopic(title);
    if (n.length < 3) continue;
    const clash = seen.some(
      (s) =>
        s === n ||
        (s.length > 8 && n.length > 8 && (s.includes(n) || n.includes(s))),
    );
    if (clash) continue;
    seen.push(n);
    out.push({ title, section: c.section.trim() });
  }
  return out;
}

/** Fallback without AI: titled headings like "Chapter 5: Memory". */
export function headingTopics(text: string): FoundTopic[] {
  const out: FoundTopic[] = [];
  const re =
    /\b(Chapter|Ch\.|Lecture|Module|Unit|Week|Topic)\s+(\d{1,2}[A-Za-z]?)\s*[:.\-–—]\s*([A-Z][A-Za-z0-9 ,'’&/()-]{3,70}?)(?=\s{2,}|\s*[.\n•|]|\s+(?:Chapter|Lecture|Module|Unit|Week|Topic)\b|$)/g;
  for (const m of text.matchAll(re)) {
    const title = m[3].replace(/[\s,;:-]+$/, "").trim();
    if (title.split(" ").length > 10) continue;
    out.push({ title, section: `${m[1].replace(".", "")} ${m[2]}` });
  }
  return out.slice(0, 12);
}

export const topicSystem = `You extract study topics from a university course document.
Return JSON {"topics":[{"title","section"}]}.
- Only topics that are actually taught or tested in the text; never invent.
- Each title is a specific concept a student could study, 2–8 words, e.g. "Market for loanable funds", "Classical conditioning".
- No administrative items (grading, deadlines, office hours, policies).
- "section" is the chapter, week or lecture the text gives, or "".
- At most 8 topics. If the text has no teachable content, return {"topics":[]}.`;

// ——— Evidence rules ———

export type TopicState =
  "unstudied" | "practicing" | "needs_review" | "mastered";
type Evidence = {
  topic: {
    id: string;
    title: string;
    mastery: TopicState;
    updated_at?: string;
    notes?: string;
  };
  assessments: {
    title: string;
    earned_score: number | null;
    maximum_score: number | null;
    due_at?: string | null;
    due_date?: string | null;
    submission_state?: string;
    updated_at?: string;
  }[];
  sessions: {
    topic_id: string | null;
    start_at: string | null;
    created_at?: string;
  }[];
  now: Date;
};

const DAY = 86400000;
const chapterOf = (s: string) =>
  s.match(/\b(?:chapter|ch\.?|module|unit|week|lecture)\s*(\d{1,2})\b/i)?.[1] ??
  null;
const words = (s: string) =>
  new Set(
    normalizeTopic(s)
      .split(" ")
      .filter((w) => w.length > 3),
  );

/** Does an assessment cover this topic? Same chapter, or two shared words. */
export function covers(
  assessmentTitle: string,
  topic: { title: string; notes?: string },
) {
  const a = chapterOf(assessmentTitle);
  const t = chapterOf(`${topic.title} ${topic.notes ?? ""}`);
  if (a && t) return a === t;
  const aw = words(assessmentTitle);
  let shared = 0;
  for (const w of words(topic.title)) if (aw.has(w)) shared++;
  return shared >= 2;
}

/**
 * What the evidence says about a topic. A status is only proposed when a
 * real record supports it; opening a file or scheduling a session never
 * counts as mastery. Returns the reason line shown under the topic.
 */
export function topicSignal({ topic, assessments, sessions, now }: Evidence): {
  suggest: TopicState | null;
  reason: string | null;
  urgent: boolean;
} {
  const t = now.getTime();
  const due = (a: Evidence["assessments"][number]) =>
    a.due_at
      ? Date.parse(a.due_at)
      : a.due_date
        ? Date.parse(a.due_date + "T23:59:00-08:00")
        : null;
  const related = assessments.filter((a) => covers(a.title, topic));
  const low = related.find(
    (a) =>
      typeof a.earned_score === "number" &&
      typeof a.maximum_score === "number" &&
      a.maximum_score > 0 &&
      a.earned_score / a.maximum_score < 0.7,
  );
  const exam = related
    .filter((a) => {
      const d = due(a);
      return (
        d !== null && d > t && d - t <= 14 * DAY && a.earned_score === null
      );
    })
    .sort((x, y) => due(x)! - due(y)!)[0];
  const studied = sessions
    .filter((s) => s.topic_id === topic.id)
    .map((s) => Date.parse(s.start_at ?? s.created_at ?? ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  if (low && topic.mastery !== "needs_review")
    return {
      suggest: "needs_review",
      reason: `${low.title}: ${Math.round((low.earned_score! / low.maximum_score!) * 100)}%`,
      urgent: true,
    };
  if (exam) {
    const days = Math.max(1, Math.round((due(exam)! - t) / DAY));
    return {
      suggest: null,
      reason: `${exam.title} in ${days} day${days === 1 ? "" : "s"}`,
      urgent: topic.mastery !== "mastered",
    };
  }
  if (studied && topic.mastery === "unstudied")
    return { suggest: "practicing", reason: "Studied recently", urgent: false };
  if (topic.mastery === "practicing") {
    const last = studied ?? Date.parse(topic.updated_at ?? "");
    if (Number.isFinite(last) && t - last > 14 * DAY)
      return {
        suggest: "needs_review",
        reason: `Not reviewed in ${Math.round((t - last) / DAY)} days`,
        urgent: false,
      };
  }
  if (low)
    return {
      suggest: null,
      reason: `${low.title}: ${Math.round((low.earned_score! / low.maximum_score!) * 100)}%`,
      urgent: true,
    };
  return { suggest: null, reason: null, urgent: false };
}

// ——— Course order ———

/**
 * Where a topic falls in the course, from what its notes and source file
 * say: "Week 4a", "Lecture Week 10_…", "Unit 1", "Chapter 6", "Day 2",
 * "Midterm 2", "Exam 1 prep". Lower comes first; topics with no clue go last.
 * Only used for ordering; nothing here is shown.
 */
export function courseOrder(topic: Record<string, unknown>) {
  const text = `${String(topic.notes ?? "")} ${String(topic.title ?? "")}`;
  const num = (re: RegExp) => {
    const m = text.match(re);
    if (!m) return null;
    const sub = m[2] ? (m[2].toLowerCase().charCodeAt(0) - 96) / 10 : 0;
    return Number(m[1]) + sub;
  };
  // Most specific first: an explicit week beats a unit or chapter number.
  const week = num(/\bweek\s*[_:]?\s*(\d{1,2})([a-z])?(?![0-9])/i);
  if (week !== null) return week;
  for (const re of [
    /\b(?:lecture|lec)\s*[_:]?\s*(\d{1,2})([a-z])?\b/i,
    /\b(?:chapter|ch\.?)\s*(\d{1,2})([a-z])?\b/i,
    /\b(?:units?|module|topic)\s*(\d{1,2})(?:\.\d+)?([a-z])?\b/i,
    /\bday\s*(\d{1,2})([a-z])?\b/i,
  ]) {
    const n = num(re);
    if (n !== null) return n;
  }
  // Exams: material for exam N sits around a third of the way per exam.
  const exam = text.match(/\b(?:midterm|mt|exam|test)\s*[_ ]?(\d)\b/i);
  if (exam) return Number(exam[1]) * 4.5;
  if (/\bfinal\b|\bmock\b|\bremaining\b/i.test(text)) return 50;
  return Number.POSITIVE_INFINITY;
}

/** Sort topics into course order; ties keep the order they were added. */
export function byCourseOrder<T extends Record<string, unknown>>(topics: T[]) {
  return topics
    .map((t, i) => ({ t, i, k: courseOrder(t) }))
    .sort(
      (a, b) =>
        a.k - b.k ||
        String(a.t.created_at ?? "").localeCompare(
          String(b.t.created_at ?? ""),
        ) ||
        a.i - b.i,
    )
    .map((x) => x.t);
}
