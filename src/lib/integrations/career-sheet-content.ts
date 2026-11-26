import type { Values } from "./sheet-ledger-model";

/** Google Sheets serial day number (what the Weekly Review "Week Of" key stores). */
export const sheetSerial = (isoDate: string) =>
  Math.round(
    (Date.UTC(
      +isoDate.slice(0, 4),
      +isoDate.slice(5, 7) - 1,
      +isoDate.slice(8, 10),
    ) -
      Date.UTC(1899, 11, 30)) /
      86400000,
  );

export type ReviewAssessment = {
  course: string;
  title: string;
  earned: number | null;
  max: number | null;
  due_date: string | null;
  graded: boolean;
};
export type ReviewTask = { title: string; due_date: string | null };
export type WeeklyReviewInput = {
  weekStart: string; // Monday, yyyy-MM-dd
  gradedThisWeek: ReviewAssessment[];
  completedTaskCount: number;
  overdue: ReviewTask[];
  dueNextWeek: ReviewAssessment[];
  topTasksNextWeek: ReviewTask[];
};
const pct = (a: ReviewAssessment) =>
  a.earned != null && a.max
    ? `${a.earned}/${a.max} (${Math.round((a.earned / a.max) * 1000) / 10}%)`
    : "graded";
const clip = (s: string) => (s.length > 900 ? s.slice(0, 897) + "..." : s);

/**
 * Weekly Review values derived only from Life OS records. Fields with no Life OS evidence are
 * omitted, never blanked, so hand-written columns (notes, basketball, networking) stay untouched.
 */
export function buildWeeklyReview(i: WeeklyReviewInput): Values {
  const out: Values = { week_of: sheetSerial(i.weekStart) };
  const wins = i.gradedThisWeek.map((a) => `${a.course} ${a.title}: ${pct(a)}`);
  if (i.completedTaskCount)
    wins.push(`${i.completedTaskCount} Life OS tasks completed`);
  if (wins.length)
    out.academic_win = clip(wins.join("; ") + ". Source: Life OS records.");
  const risks = [
    ...i.dueNextWeek.map(
      (a) => `${a.course} ${a.title} due ${a.due_date ?? "date unset"}`,
    ),
    ...i.overdue.slice(0, 3).map((t) => `Overdue: ${t.title}`),
  ];
  if (risks.length) out.academic_risk = clip(risks.join("; "));
  if (i.topTasksNextWeek.length)
    out.top_three = clip(
      i.topTasksNextWeek
        .slice(0, 3)
        .map((t, n) => `${n + 1}. ${t.title}`)
        .join(" "),
    );
  return out;
}
