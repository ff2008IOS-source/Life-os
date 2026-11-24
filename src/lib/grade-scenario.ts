import {
  academicGrade,
  type GradeAssessment,
  type GradeCategory,
} from "./academic-grades";
export function gradeScenario(
  method: string,
  rows: GradeAssessment[],
  categories: GradeCategory[],
  target: number,
  evidence: { inventoryComplete: boolean; rulesVerified: boolean },
) {
  if (!Number.isFinite(target) || target < 0 || target > 100)
    return { status: "invalid" as const };
  if (
    !evidence.inventoryComplete ||
    !evidence.rulesVerified ||
    rows.some((a) => a.score_conflict)
  )
    return { status: "unavailable" as const };
  const active = rows.filter(
    (a) => !a.dropped && a.submission_state !== "excused",
  );
  if (!active.length) return { status: "unavailable" as const };
  const missing = active.filter(
    (a) =>
      a.earned_score === null ||
      a.maximum_score === null ||
      a.maximum_score <= 0,
  );
  if (!missing.length)
    return {
      status: "complete" as const,
      grade: academicGrade(method, rows, categories, evidence).overall_grade,
    };
  // Point-based weights need each item's possible points. An ungraded item
  // with no listed points (an optional bonus, a practice item) can't be
  // sized, so it's left out of the projection and counted in `excluded`.
  // When every item in a category is ungraded, sizes don't matter: the
  // category's fraction equals the hypothetical percentage.
  const wholeCategoryMissing = (a: GradeAssessment) =>
    method === "category_weights" &&
    active
      .filter((x) => x.category_id === a.category_id)
      .every((x) => missing.includes(x));
  const unsized = missing.filter(
    (a) =>
      (!a.maximum_score || a.maximum_score <= 0) &&
      (method === "points" ||
        (method === "category_weights" &&
          categories.find((c) => c.id === a.category_id)?.aggregation ===
            "points" &&
          !wholeCategoryMissing(a))),
  );
  if (unsized.length) {
    const skip = new Set(unsized.map((a) => a.id));
    const kept = active.filter((a) => !skip.has(a.id));
    const left = missing.filter((a) => !skip.has(a.id));
    if (!left.length) return { status: "unavailable" as const };
    active.splice(0, active.length, ...kept);
    missing.splice(0, missing.length, ...left);
  }
  const ids = new Set(missing.map((a) => a.id));
  const calculate = (percent: number) =>
    academicGrade(
      method,
      active.map((a) =>
        ids.has(a.id)
          ? {
              ...a,
              earned_score:
                (percent / 100) *
                (a.maximum_score && a.maximum_score > 0
                  ? a.maximum_score
                  : 100),
              maximum_score:
                a.maximum_score && a.maximum_score > 0 ? a.maximum_score : 100,
              verification_status: "user_confirmed",
              submission_state: "returned",
            }
          : a,
      ),
      categories,
      evidence,
    ).overall_grade;
  const maximum = calculate(100),
    minimum = calculate(0);
  if (maximum === null || minimum === null)
    return { status: "unavailable" as const };
  if (target > maximum + 0.00001)
    return { status: "unreachable" as const, maximum };
  let low = 0,
    high = 100;
  for (let n = 0; n < 40; n++) {
    const mid = (low + high) / 2;
    if (calculate(mid)! >= target) high = mid;
    else low = mid;
  }
  return {
    status: "required" as const,
    percent: target <= minimum ? 0 : high,
    remaining: missing.length,
    excluded: unsized.length,
  };
}
