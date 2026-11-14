import type { GradeSummary } from "./academic-grades";
type Assessment = {
  id: string;
  title?: unknown;
  earned_score?: unknown;
  maximum_score?: unknown;
  due_date?: unknown;
  due_at?: unknown;
  submission_state?: unknown;
  source_key?: unknown;
  dropped?: unknown;
};
export function assessmentResult(a: Assessment) {
  return typeof a.earned_score === "number" &&
    typeof a.maximum_score === "number" &&
    a.maximum_score > 0
    ? `${a.earned_score} / ${a.maximum_score} · ${Number(((a.earned_score / a.maximum_score) * 100).toFixed(1))}%`
    : a.submission_state === "excused"
      ? "Excused"
      : a.submission_state === "submitted"
        ? "Awaiting grade"
        : "Not recorded";
}
export function submissionLabel(value: unknown) {
  return (
    (
      {
        unknown: "Not confirmed",
        not_submitted: "Not submitted",
        submitted: "Submitted",
        returned: "Returned",
        excused: "Excused",
      } as Record<string, string>
    )[String(value)] ?? "Not confirmed"
  );
}
export function standingLabel(summary: GradeSummary, rulesVerified: boolean) {
  if (rulesVerified && summary.overall_grade !== null)
    return {
      title: "Course result",
      value: `${summary.overall_grade.toFixed(1)}%`,
    };
  if (rulesVerified && summary.graded_average !== null)
    return {
      title: "Current standing",
      value: `${summary.graded_average.toFixed(1)}%`,
    };
  return {
    title: "Results so far",
    value: `${summary.known_scores} ${summary.known_scores === 1 ? "result" : "results"}`,
  };
}
/** A review hint, never proof of identity and never an automatic merge. */
export function possibleAssessmentDuplicates(rows: Assessment[]) {
  const normalize = (value: unknown) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/\bexam\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return rows.flatMap((a, i) =>
    rows
      .slice(i + 1)
      .filter(
        (b) =>
          !a.dropped &&
          !b.dropped &&
          normalize(a.title).length > 2 &&
          normalize(a.title) === normalize(b.title),
      )
      .map((b) => [a.id, b.id]),
  );
}
