/**
 * What to do about a course update or email. Plain rules, so every
 * suggestion is explainable, and nothing changes until the owner approves:
 * - a new mark  → enter it (Crowdmark has no student API) or show it's in;
 * - a moved date → offer to move that assessment;
 * - a grading change → check the course's grading rules;
 * - a personal email with a dated deadline → offer a task.
 */
export type ActionAssessment = {
  id: string;
  course_id: string;
  title: string;
  due_at: string | null;
  due_date: string | null;
  earned_score: number | null;
  maximum_score: number | null;
  source_key: string | null;
};

export type ActionMessage = {
  id: string;
  course_id: string | null;
  title: string;
  body: string;
  posted_at: string;
  flags: string[];
};

export type UpdateAction =
  | {
      kind: "enter_mark";
      assessment_id: string;
      assessment: string;
      maximum: number | null;
    }
  | { kind: "mark_recorded"; assessment: string; percent: number }
  | { kind: "open_grades" }
  | {
      kind: "move_date";
      assessment_id: string;
      assessment: string;
      from: string | null;
      to: string;
    }
  | { kind: "check_rules" }
  | { kind: "add_task"; title: string; due_date: string };

const KIND =
  /\b(final exam|final|midterm|exam|quiz|assignment|lab|project|test|essay|paper|homework|problem set|reading response|tutorial)\s*#?\s*(\d+)?\b/gi;

const norm = (kind: string, n?: string) => {
  const k = kind.toLowerCase().replace("final exam", "final");
  return `${k}${n ? ` ${Number(n)}` : ""}`;
};

/** "Exam 2", "Quiz #4", "Final exam" → comparable keys. */
export function assessmentKeys(text: string) {
  const keys: string[] = [];
  for (const m of text.matchAll(KIND)) {
    const key = norm(m[1], m[2]);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** The assessment an update is about, in its course (best match first). */
export function matchAssessment(
  m: ActionMessage,
  assessments: ActionAssessment[],
) {
  if (!m.course_id) return null;
  const mine = assessments.filter((a) => a.course_id === m.course_id);
  for (const key of assessmentKeys(`${m.title}\n${m.body.slice(0, 600)}`)) {
    const hits = mine.filter((a) => assessmentKeys(a.title)[0] === key);
    if (!hits.length) continue;
    // Prefer the syllabus record over a blank Canvas copy, and one with a mark.
    return [...hits].sort(
      (a, b) =>
        Number(b.earned_score !== null) - Number(a.earned_score !== null) ||
        Number(!b.source_key?.startsWith("canvas:")) -
          Number(!a.source_key?.startsWith("canvas:")),
    )[0];
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?";
const WEEKDAY =
  "(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\\s+)?";

const iso = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Month name, day and optional year from the last three groups of a match. */
function resolve(match: RegExpMatchArray, posted: string) {
  const [month, day, year] = match.slice(-3);
  const mo = MONTHS[month.toLowerCase().slice(0, 3)];
  const d = Number(day);
  if (!mo || d < 1 || d > 31) return null;
  const p = new Date(posted);
  let y = year ? Number(year) : p.getUTCFullYear();
  // "Jan 12" in a December email means next January.
  if (!year && Date.UTC(y, mo - 1, d) < p.getTime() - 45 * 86400000) y++;
  return iso(y, mo, d);
}

/** The new date in "moved to Dec 9", "rescheduled to Friday, December 4". */
export function movedDate(text: string, posted: string) {
  const m = text.match(
    new RegExp(
      `\\b(?:moved?|postponed|rescheduled|changed|pushed|shifted|now)\\b[^.\\n]{0,40}?\\b(?:to|on|until)\\s+${WEEKDAY}${MONTH}`,
      "i",
    ),
  );
  return m ? resolve(m, posted) : null;
}

/** A deadline date in a personal email ("due Dec 3", "by January 15"). */
export function deadlineDate(text: string, posted: string) {
  const m = text.match(
    new RegExp(
      `\\b(?:due|deadline|by|before|until|expires?|appointment|on)\\b[^.\\n]{0,25}?${WEEKDAY}${MONTH}`,
      "i",
    ),
  );
  return m ? resolve(m, posted) : null;
}

const DEADLINE_WORDS =
  /\b(due|deadline|appointment|reminder|enrol(?:l)?ment|tuition|fee|payment|expires?|renew|last day|submit|register)\b/i;

const dayOf = (a: ActionAssessment) =>
  a.due_date ??
  (a.due_at
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Vancouver",
      }).format(new Date(a.due_at))
    : null);

/** A Canvas notification email (its marks arrive through the Canvas sync). */
export const fromCanvas = (m: Pick<ActionMessage, "title" | "body">) =>
  /^(submission posted|assignment graded|submission comment|grade posted)\b/i.test(
    m.title,
  ) || /canvas\.sfu\.ca\/courses\/\d+\/(assignments|grades)/i.test(m.body);

export function actionFor(
  m: ActionMessage,
  assessments: ActionAssessment[],
  today: string,
): UpdateAction | null {
  const text = `${m.title}\n${m.body.slice(0, 1500)}`;
  if (m.course_id) {
    const a = matchAssessment(m, assessments);
    if (m.flags.includes("schedule") && a) {
      const to = movedDate(text, m.posted_at);
      if (to && to >= today && to !== dayOf(a))
        return {
          kind: "move_date",
          assessment_id: a.id,
          assessment: a.title,
          from: dayOf(a),
          to,
        };
    }
    if (m.flags.includes("mark")) {
      // Canvas marks reach Life OS through the Canvas sync on their own.
      if (!a) return fromCanvas(m) ? null : { kind: "open_grades" };
      if (a.earned_score !== null && a.maximum_score)
        return {
          kind: "mark_recorded",
          assessment: a.title,
          percent: Math.round((a.earned_score / a.maximum_score) * 1000) / 10,
        };
      return {
        kind: "enter_mark",
        assessment_id: a.id,
        assessment: a.title,
        maximum: a.maximum_score,
      };
    }
    if (m.flags.includes("grading")) return { kind: "check_rules" };
    return null;
  }
  if (!DEADLINE_WORDS.test(text)) return null;
  const due = deadlineDate(text, m.posted_at);
  if (!due || due < today) return null;
  return {
    kind: "add_task",
    title: m.title.replace(/^(re|fw|fwd):\s*/i, "").slice(0, 200),
    due_date: due,
  };
}

/** Today shows at most this many, most useful first. */
export const ACTION_RANK: Record<UpdateAction["kind"], number> = {
  move_date: 0,
  enter_mark: 1,
  check_rules: 2,
  add_task: 3,
  open_grades: 4,
  mark_recorded: 5,
};
