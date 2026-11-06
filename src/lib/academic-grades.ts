export type GradeAssessment = {
  id: string;
  category_id: string | null;
  weight: number | null;
  maximum_score: number | null;
  earned_score: number | null;
  dropped: boolean;
  submission_state: string;
};
export type GradeCategory = {
  id: string;
  weight: number | null;
  drop_lowest_count: number;
  aggregation: "unknown" | "points" | "equal_items" | "assessment_weights";
};
export type GradeSummary = {
  graded_average: number | null;
  overall_grade: number | null;
  graded_weight: number | null;
  known_scores: number;
  missing_scores: number;
  warnings: string[];
};
export function academicGrade(
  method: string,
  assessments: GradeAssessment[],
  categories: GradeCategory[] = [],
): GradeSummary {
  const active = assessments.filter(
    (a) => !a.dropped && a.submission_state !== "excused",
  );
  const scored = active.filter(
    (a) =>
      a.earned_score !== null &&
      a.maximum_score !== null &&
      a.maximum_score > 0,
  );
  const result: GradeSummary = {
    graded_average: null,
    overall_grade: null,
    graded_weight: null,
    known_scores: scored.length,
    missing_scores: active.length - scored.length,
    warnings: [],
  };
  if (!active.length) return result;
  if (method === "unknown") {
    result.warnings.push(
      "The grading formula is not confirmed. Recorded scores are shown without a course average.",
    );
    return result;
  }
  if (method === "points") {
    const earned = scored.reduce((n, a) => n + a.earned_score!, 0),
      maximum = scored.reduce((n, a) => n + a.maximum_score!, 0);
    result.graded_average = maximum ? (earned / maximum) * 100 : null;
    if (result.missing_scores === 0)
      result.overall_grade = result.graded_average;
    return result;
  }
  if (method === "assessment_weights") {
    const known = scored.filter((a) => a.weight !== null);
    const weight = known.reduce((n, a) => n + a.weight!, 0);
    const earned = known.reduce(
      (n, a) => n + (a.earned_score! / a.maximum_score!) * a.weight!,
      0,
    );
    result.graded_weight = weight;
    result.graded_average = weight ? (earned / weight) * 100 : null;
    const total = active.reduce((n, a) => n + (a.weight ?? 0), 0);
    if (active.some((a) => a.weight === null))
      result.warnings.push("Some assessment weights are unknown.");
    if (Math.abs(total - 100) > 0.001)
      result.warnings.push("Recorded assessment weights do not total 100%.");
    if (
      !result.missing_scores &&
      active.every((a) => a.weight !== null) &&
      Math.abs(total - 100) < 0.001
    )
      result.overall_grade = earned;
    return result;
  }
  if (method === "category_weights") {
    if (
      !categories.length ||
      active.some(
        (a) =>
          !a.category_id || !categories.some((c) => c.id === a.category_id),
      )
    ) {
      result.warnings.push(
        "Every included assessment needs a configured grading category.",
      );
      return result;
    }
    let weighted = 0,
      covered = 0,
      complete = true;
    for (const category of categories) {
      let items = active.filter((a) => a.category_id === category.id);
      if (!items.length) {
        complete = false;
        continue;
      }
      if (category.aggregation === "unknown" || category.weight === null) {
        result.warnings.push("A category formula or weight is unknown.");
        complete = false;
        continue;
      }
      const missing = items.some(
        (a) => a.earned_score === null || !a.maximum_score,
      );
      if (missing) complete = false;
      if (category.drop_lowest_count) {
        if (missing) {
          result.warnings.push(
            "Dropped-lowest rules cannot be finalized until all category scores are known.",
          );
          continue;
        }
        items = items
          .toSorted(
            (a, b) =>
              a.earned_score! / a.maximum_score! -
              b.earned_score! / b.maximum_score!,
          )
          .slice(category.drop_lowest_count);
      }
      const known = items.filter(
        (a) => a.earned_score !== null && !!a.maximum_score,
      );
      if (!known.length) {
        complete = false;
        continue;
      }
      let fraction: number | null = null;
      if (category.aggregation === "points")
        fraction =
          known.reduce((n, a) => n + a.earned_score!, 0) /
          known.reduce((n, a) => n + a.maximum_score!, 0);
      if (category.aggregation === "equal_items")
        fraction =
          known.reduce((n, a) => n + a.earned_score! / a.maximum_score!, 0) /
          known.length;
      if (category.aggregation === "assessment_weights") {
        if (items.some((a) => a.weight === null)) {
          result.warnings.push(
            "A within-category assessment weight is missing.",
          );
          complete = false;
          continue;
        }
        const total = known.reduce((n, a) => n + a.weight!, 0);
        fraction = total
          ? known.reduce(
              (n, a) => n + (a.earned_score! / a.maximum_score!) * a.weight!,
              0,
            ) / total
          : null;
      }
      if (fraction !== null) {
        weighted += fraction * category.weight;
        covered += category.weight;
      }
    }
    result.graded_average = covered ? (weighted / covered) * 100 : null;
    result.graded_weight = covered;
    if (
      Math.abs(categories.reduce((n, c) => n + (c.weight ?? 0), 0) - 100) >
      0.001
    ) {
      result.warnings.push("Category weights do not total 100%.");
      complete = false;
    }
    if (complete && Math.abs(covered - 100) < 0.001)
      result.overall_grade = weighted;
    return result;
  }
  return result;
}
