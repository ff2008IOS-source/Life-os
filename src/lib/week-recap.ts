import { formatInTimeZone } from "date-fns-tz";

/**
 * A week in review, filled in from what was actually recorded: tasks
 * finished, deadlines handled, marks returned, goals moved and study done.
 * Nothing is estimated; empty parts stay empty.
 */
const ZONE = "America/Vancouver";
const DONE = ["submitted", "returned", "excused", "graded"];

type Row = Record<string, unknown> & { id: string };
export type RecapInput = {
  /** Monday and Sunday of the week, yyyy-MM-dd in Vancouver time. */
  weekStart: string;
  weekEnd: string;
  tasks: {
    id: string;
    title: string;
    completed_at: string | null;
    deleted_at?: string | null;
  }[];
  goals: { id: string; title: string; status: string; is_example?: boolean }[];
  milestones: {
    id: string;
    goal_id: string | null;
    title: string;
    completed_at: string | null;
  }[];
  goalTasks: { goal_id: string; task_id: string }[];
  courses: Row[];
  assessments: Row[];
  topics: Row[];
  sessions: Row[];
};

const localDay = (iso: string) => formatInTimeZone(iso, ZONE, "yyyy-MM-dd");
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function weekRecap(x: RecapInput) {
  const inWeek = (iso: unknown) => {
    if (!iso) return false;
    const d = localDay(String(iso));
    return d >= x.weekStart && d <= x.weekEnd;
  };
  const code = (id: unknown) =>
    str(x.courses.find((c) => c.id === id)?.code) || "Course";
  const dueDay = (a: Row) =>
    a.due_at ? localDay(String(a.due_at)) : a.due_date ? str(a.due_date) : null;

  const tasksDone = x.tasks.filter(
    (t) => !t.deleted_at && inWeek(t.completed_at),
  );
  const due = x.assessments.filter((a) => {
    const d = dueDay(a);
    return !a.dropped && d && d >= x.weekStart && d <= x.weekEnd;
  });
  const handled = due.filter(
    (a) =>
      DONE.includes(str(a.submission_state)) ||
      typeof a.earned_score === "number",
  );
  const missed = due.filter(
    (a) =>
      !handled.includes(a) &&
      Date.parse(str(a.due_at) || str(a.due_date) + "T23:59:00-08:00") <
        Date.now(),
  );
  const marks = due
    .filter(
      (a) =>
        typeof a.earned_score === "number" &&
        typeof a.maximum_score === "number" &&
        Number(a.maximum_score) > 0,
    )
    .map((a) => ({
      title: str(a.title),
      course: code(a.course_id),
      percent: (Number(a.earned_score) / Number(a.maximum_score)) * 100,
    }));
  const milestones = x.milestones.filter((m) => inWeek(m.completed_at));
  const goalsMoved = x.goals.filter(
    (g) =>
      g.status === "active" &&
      !g.is_example &&
      (milestones.some((m) => m.goal_id === g.id) ||
        x.goalTasks.some(
          (l) =>
            l.goal_id === g.id && tasksDone.some((t) => t.id === l.task_id),
        )),
  );
  const topicsImproved = x.topics.filter(
    (t) =>
      inWeek(t.updated_at) &&
      ["practicing", "mastered"].includes(str(t.mastery)),
  );
  const study = x.sessions.filter((s) => inWeek(s.start_at ?? s.created_at));
  const studyMinutes = study.reduce(
    (n, s) => n + (Number(s.actual_minutes) || 0),
    0,
  );
  return {
    tasksDone: tasksDone.map((t) => t.title),
    deadlines: {
      handled: handled.length,
      total: due.length,
      missed: missed.map((a) => `${code(a.course_id)} · ${str(a.title)}`),
    },
    marks,
    goalsMoved: goalsMoved.map((g) => g.title),
    milestones: milestones.map((m) => m.title),
    topicsImproved: topicsImproved.map(
      (t) => `${code(t.course_id)} · ${str(t.title)}`,
    ),
    studySessions: study.length,
    studyMinutes,
  };
}
export type WeekRecap = ReturnType<typeof weekRecap>;

const list = (items: string[], max = 5) =>
  items.length > max
    ? `${items.slice(0, max).join("; ")}; and ${items.length - max} more`
    : items.join("; ");

/** Plain-text highlights for the review's "achievements" field. */
export function recapText(r: WeekRecap) {
  const lines: string[] = [];
  if (r.deadlines.total)
    lines.push(
      `Handled ${r.deadlines.handled} of ${r.deadlines.total} deadlines.`,
    );
  if (r.marks.length)
    lines.push(
      `Marks back: ${list(r.marks.map((m) => `${m.course} ${m.title} ${Math.round(m.percent * 10) / 10}%`))}.`,
    );
  if (r.tasksDone.length)
    lines.push(
      `Finished ${r.tasksDone.length} task${r.tasksDone.length === 1 ? "" : "s"}: ${list(r.tasksDone)}.`,
    );
  if (r.milestones.length)
    lines.push(`Milestones reached: ${list(r.milestones)}.`);
  if (r.goalsMoved.length)
    lines.push(`Goals moved forward: ${list(r.goalsMoved)}.`);
  if (r.topicsImproved.length)
    lines.push(`Topics improved: ${list(r.topicsImproved)}.`);
  if (r.studySessions)
    lines.push(
      `Logged ${r.studySessions} study session${r.studySessions === 1 ? "" : "s"}${r.studyMinutes ? ` (${r.studyMinutes} min)` : ""}.`,
    );
  return lines.join("\n");
}
