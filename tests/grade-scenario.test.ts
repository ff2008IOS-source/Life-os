import { it, expect } from "vitest";
import { gradeScenario } from "@/lib/grade-scenario";
const known = {
  id: "known",
  category_id: null,
  weight: 40,
  maximum_score: 100,
  earned_score: 87.5,
  dropped: false,
  submission_state: "returned",
  verification_status: "verified",
};
const pending = {
  ...known,
  id: "pending",
  weight: 60,
  earned_score: null,
  maximum_score: null,
  submission_state: "unknown",
  verification_status: "unverified",
};
const evidence = { rulesVerified: true, inventoryComplete: true };
it("keeps target scenarios separate from earned scores and supports unknown score units", () => {
  const rows = [known, pending],
    before = structuredClone(rows);
  const result = gradeScenario("assessment_weights", rows, [], 80, evidence);
  expect(result.status).toBe("required");
  if (result.status === "required") expect(result.percent).toBeCloseTo(75);
  expect(rows).toEqual(before);
});
it("does not project from unconfirmed rules or conflicting source scores", () => {
  expect(
    gradeScenario("assessment_weights", [known, pending], [], 80, {
      ...evidence,
      rulesVerified: false,
    }).status,
  ).toBe("unavailable");
  expect(
    gradeScenario(
      "assessment_weights",
      [{ ...known, score_conflict: true }, pending],
      [],
      80,
      evidence,
    ).status,
  ).toBe("unavailable");
});
it("reports unreachable targets and validates ranges", () => {
  const result = gradeScenario(
    "assessment_weights",
    [known, pending],
    [],
    100,
    evidence,
  );
  expect(result.status).toBe("unreachable");
  if (result.status === "unreachable") expect(result.maximum).toBe(95);
  expect(
    gradeScenario("assessment_weights", [known, pending], [], 101, evidence)
      .status,
  ).toBe("invalid");
});

it("never invents possible points when they determine assessment weight", () => {
  expect(
    gradeScenario("points", [known, pending], [], 80, evidence).status,
  ).toBe("unavailable");
});
it("projects a category that is entirely ungraded even when its size is unknown", () => {
  // ECON 113 shape: Midterm 87.5/100 (40%), Final exam of unknown size (50%),
  // participation not graded yet (10%).
  const cats = [
    {
      id: "mid",
      weight: 40,
      drop_lowest_count: 0,
      aggregation: "points" as const,
    },
    {
      id: "fin",
      weight: 50,
      drop_lowest_count: 0,
      aggregation: "points" as const,
    },
    {
      id: "par",
      weight: 10,
      drop_lowest_count: 0,
      aggregation: "points" as const,
    },
  ];
  const rows = [
    { ...known, category_id: "mid", weight: null },
    { ...pending, id: "final", category_id: "fin", weight: null },
    { ...pending, id: "part", category_id: "par", weight: null },
  ];
  const r = gradeScenario("category_weights", rows, cats, 85, evidence);
  expect(r.status).toBe("required");
  // 0.4 × 87.5 + 0.6 × p = 85  →  p ≈ 83.3
  if (r.status === "required") expect(r.percent).toBeCloseTo(83.33, 1);
});
it("still refuses when an unknown-size item shares a category with graded work", () => {
  const cats = [
    {
      id: "c",
      weight: 100,
      drop_lowest_count: 0,
      aggregation: "points" as const,
    },
  ];
  const rows = [
    { ...known, category_id: "c", weight: null },
    { ...pending, category_id: "c", weight: null },
  ];
  expect(
    gradeScenario("category_weights", rows, cats, 85, evidence).status,
  ).toBe("unavailable");
});
it("leaves unsized optional items out of a points projection and says so", () => {
  const rows = [
    { ...known, weight: null, earned_score: 80, maximum_score: 100 },
    { ...pending, id: "exam", weight: null, maximum_score: 100 },
    { ...pending, id: "bonus", weight: null, maximum_score: null },
  ];
  const r = gradeScenario("points", rows, [], 85, evidence);
  expect(r.status).toBe("required");
  if (r.status === "required") {
    expect(r.percent).toBeCloseTo(90);
    expect(r.remaining).toBe(1);
    expect(r.excluded).toBe(1);
  }
});
