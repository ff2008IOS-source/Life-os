export type GradeAssessment = {
  id: string;
  category_id: string | null;
  weight: number | null;
  maximum_score: number | null;
  earned_score: number | null;
  dropped: boolean;
  submission_state: string;
  verification_status?: string;
  score_conflict?: boolean;
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
/**
 * Canvas reports a 0 on work that's handed in but not marked yet
 * ("submitted", not "graded"/"returned"). That 0 is a placeholder, not a
 * result, so it never counts.
 */
export function awaitingMark(a: {
  earned_score: number | null;
  submission_state?: string;
}) {
  return a.submission_state === "submitted" && a.earned_score === 0;
}
export function withoutPlaceholders<
  T extends { earned_score: number | null; submission_state?: string },
>(rows: T[]): T[] {
  return rows.map((a) => (awaitingMark(a) ? { ...a, earned_score: null } : a));
}

export function academicGrade(
  method: string,
  assessments: GradeAssessment[],
  categories: GradeCategory[] = [],
  evidence: { inventoryComplete: boolean; rulesVerified: boolean } = {
    inventoryComplete: false,
    rulesVerified: false,
  },
): GradeSummary {
  const active = withoutPlaceholders(assessments).filter(
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
  const finalAllowed =
    evidence.inventoryComplete &&
    evidence.rulesVerified &&
    active.every((a) =>
      ["verified", "user_confirmed"].includes(a.verification_status ?? ""),
    );
  if (!finalAllowed)
    result.warnings.push(
      "Overall grade unavailable: confirm the full assessment inventory, grading rules and score sources. Recorded-score averages are not final course grades.",
    );
  if (!active.length) return result;
  if (active.some((a) => a.score_conflict)) {
    result.warnings.push(
      "Source results conflict; review the original records before calculating standing.",
    );
    return result;
  }
  if (method === "unknown") {
    result.warnings.push(
      "The grading formula is not confirmed. Recorded scores are shown without a course average.",
    );
    return result;
  }
  if (method === "points") {
    // Categories with a drop-lowest rule (e.g. "6 ZAPS, lowest dropped")
    // drop their lowest graded results, as Canvas does.
    const dropped = new Set<string>();
    for (const c of categories)
      if (c.drop_lowest_count > 0) {
        const graded = scored
          .filter((a) => a.category_id === c.id)
          .toSorted(
            (a, b) =>
              a.earned_score! / a.maximum_score! -
              b.earned_score! / b.maximum_score!,
          );
        if (graded.length > c.drop_lowest_count)
          for (const a of graded.slice(0, c.drop_lowest_count))
            dropped.add(a.id);
      }
    const counted = scored.filter((a) => !dropped.has(a.id));
    const earned = counted.reduce((n, a) => n + a.earned_score!, 0),
      maximum = counted.reduce((n, a) => n + a.maximum_score!, 0);
    result.graded_average = maximum ? (earned / maximum) * 100 : null;
    if (finalAllowed && result.missing_scores === 0)
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
      finalAllowed &&
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
    if (finalAllowed && complete && Math.abs(covered - 100) < 0.001)
      result.overall_grade = weighted;
    return result;
  }
  return result;
}
