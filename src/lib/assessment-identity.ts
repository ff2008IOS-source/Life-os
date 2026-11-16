/** Read projection only: imports remain intact, so a refresh cannot recreate visible duplicates. */
type RecordRow = {
  id: string;
  title?: unknown;
  course_id?: unknown;
  source_key?: unknown;
  [key: string]: unknown;
};
export type AssessmentGroup<T> = T & {
  source_records?: T[];
  components?: T[];
  alternatives?: T[];
  identity_note?: string;
  score_conflict?: boolean;
  collection?: boolean;
};
const normalized = (x: unknown) =>
  String(x ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:fall|spring|summer|winter)\s*20\d{2}\b/g, " ")
    .replace(/\bmidterm\s+exam\b/g, "midterm")
    .replace(/\bfinal\s+exam\b/g, "final")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const scored = (a: RecordRow) =>
  typeof a.earned_score === "number" &&
  typeof a.maximum_score === "number" &&
  a.maximum_score > 0;
const canvas = (a: RecordRow) =>
  String(a.source_key ?? "").startsWith("canvas:");
function identity(a: RecordRow) {
  const title = normalized(a.title);
  const exam = /^(?:exam|test)\s*(\d+)\b/.exec(title);
  if (exam)
    return {
      key: `exam ${exam[1]}`,
      part: /\b(multiple choice|mcq|short answer|essay)\b/.exec(title)?.[1],
      alternative: /\b(makeups?|resits?|retakes?)\b/.test(title),
    };
  const numbered =
    /^(zaps?|assignment|quiz|knowledge test|writing session)\s*(\d+)\b/.exec(
      title,
    );
  return {
    key: numbered ? `${numbered[1]} ${numbered[2]}` : title,
    part: undefined,
    alternative: false,
  };
}
export function reconcileAssessments<T extends RecordRow>(
  input: T[],
): AssessmentGroup<T>[] {
  // Always start from source rows; this also makes applying the projection twice idempotent.
  const rows = input.flatMap((a) =>
    Array.isArray(a.source_records) ? (a.source_records as T[]) : [a],
  );
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.course_id ?? ""}:${identity(row).key}:${row.dropped === true}`;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const result: AssessmentGroup<T>[] = [];
  for (const family of buckets.values()) {
    if (family.length === 1) {
      result.push(family[0]);
      continue;
    }
    const primary = family.filter(
      (a) => !identity(a).part && !identity(a).alternative,
    );
    const parts = family.filter((a) => identity(a).part);
    const alternatives = family.filter((a) => identity(a).alternative);
    const partKeys = parts.map((a) => identity(a).part);
    const uniqueParts = partKeys.length === new Set(partKeys).size;
    const summaries = primary.filter((a) => !canvas(a));
    const imported = primary.filter(canvas);
    const summary = summaries.length === 1 ? summaries[0] : undefined;
    const sameDates = (a: T, b: T) =>
      (!a.due_at && !a.due_date) ||
      (!b.due_at && !b.due_date) ||
      String(a.due_date ?? a.due_at).slice(0, 10) ===
        String(b.due_date ?? b.due_at).slice(0, 10);
    const canGroup =
      uniqueParts &&
      ((parts.length >= 2 && primary.length <= 1) ||
        (!parts.length &&
          !!summary &&
          imported.length === 1 &&
          sameDates(summary, imported[0])));
    if (!canGroup) {
      result.push(...family);
      continue;
    }
    const base = summary ?? imported[0] ?? parts[0];
    const evidence = parts.length ? parts : imported;
    const allScored = evidence.every(scored);
    const earned = evidence.reduce(
      (n, a) => n + (typeof a.earned_score === "number" ? a.earned_score : 0),
      0,
    );
    const maximum = evidence.reduce(
      (n, a) => n + (typeof a.maximum_score === "number" ? a.maximum_score : 0),
      0,
    );
    const explicitMissing = evidence.some(
      (a) => a.submission_state === "not_submitted" && scored(a),
    );
    const conflict =
      explicitMissing ||
      (scored(base) &&
        allScored &&
        Math.abs(
          Number(base.earned_score) / Number(base.maximum_score) -
            earned / maximum,
        ) > 0.001);
    const due = evidence.find((a) => a.due_at || a.due_date);
    const returned =
      !explicitMissing &&
      (allScored ||
        evidence.every((a) =>
          ["returned", "excused"].includes(String(a.submission_state)),
        ));
    result.push({
      ...base,
      title: primary.length
        ? base.title
        : identity(base).key.replace(/^exam/, "Exam"),
      due_at: due?.due_at ?? base.due_at,
      due_date: due?.due_at ? null : (due?.due_date ?? base.due_date),
      ...(allScored && !conflict && !scored(base)
        ? { earned_score: earned, maximum_score: maximum, score_unit: "points" }
        : {}),
      submission_state: returned
        ? "returned"
        : evidence.every((a) => a.submission_state === "submitted")
          ? "submitted"
          : base.submission_state,
      source_records: family,
      components: evidence,
      alternatives,
      score_conflict: conflict,
      identity_note: conflict
        ? "Source results differ. Both are retained for review."
        : parts.length
          ? "Matched exam components in this course. Combined points are not a separately reported official grade."
          : "Matched the course summary to its source assessment.",
    });
  }
  return result;
}
export function assessmentStatus(a: RecordRow) {
  if (a.score_conflict) return "Results need review";
  if (Array.isArray(a.components) && a.components.length > 1) {
    const known = (a.components as RecordRow[]).filter(scored).length;
    if (known > 0 && known < a.components.length)
      return `${known} of ${a.components.length} parts graded`;
  }
  if (scored(a)) return a.score_conflict ? "Results need review" : "Graded";
  return null;
}
