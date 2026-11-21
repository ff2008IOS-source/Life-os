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
