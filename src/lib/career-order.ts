/**
 * Orders imported career plan rows the way a person reads them: Year 1 before
 * Year 4, Fall 2026 before Spring 2027, and the newest reflection first.
 */
const SEASON: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
  autumn: 3,
};

export function termKey(text: string): number | null {
  const term = text.match(/\b(winter|spring|summer|fall|autumn)\s+(\d{4})\b/i);
  if (term) return Number(term[2]) * 10 + SEASON[term[1].toLowerCase()];
  const year = text.match(/\byear\s+(\d{1,2})\b/i);
  if (year) return Number(year[1]);
  return null;
}

function dateKey(text: string): number | null {
  if (!/\b\d{4}\b/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export type CareerGroup =
  "plan" | "skills" | "network" | "reflections" | "other";
export const CAREER_GROUPS: { id: CareerGroup; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "skills", label: "Skills & portfolio" },
  { id: "network", label: "Network" },
  { id: "reflections", label: "Reflections" },
  { id: "other", label: "More" },
];

export function careerGroup(title: string): CareerGroup {
  const t = title.toLowerCase();
  if (/reflection|weekly review/.test(t)) return "reflections";
  if (/skill|portfolio/.test(t)) return "skills";
  if (/application|pipeline|contact|network/.test(t)) return "network";
  if (/roadmap|semester|internship|co-op|year|plan/.test(t)) return "plan";
  return "other";
}

/**
 * Stable sort: term and year rows ascending; rows that are dates (reflections)
 * newest first; anything else keeps its sheet order after the dated rows.
 */
export function orderCareerRows<T>(rows: T[], title: (row: T) => string): T[] {
  const keyed = rows.map((row, i) => {
    const t = title(row);
    return { row, i, term: termKey(t), date: dateKey(t) };
  });
  return keyed
    .sort((a, b) => {
      if (a.term !== null && b.term !== null)
        return a.term - b.term || a.i - b.i;
      if (a.term !== null) return -1;
      if (b.term !== null) return 1;
      if (a.date !== null && b.date !== null)
        return b.date - a.date || a.i - b.i;
      if (a.date !== null) return -1;
      if (b.date !== null) return 1;
      return a.i - b.i;
    })
    .map((k) => k.row);
}
