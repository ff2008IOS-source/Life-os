import { describe, it, expect } from "vitest";
import { academicGrade, type GradeAssessment } from "@/lib/academic-grades";
import { mapCareerSnapshot } from "@/lib/integrations/career-mapping";
import { mapAcademicSnapshot } from "@/lib/integrations/academic-mapping";
import { academicSchemas } from "@/lib/academic-schemas";
const assessment = (
  id: string,
  score: number | null,
  weight: number | null,
): GradeAssessment => ({
  id,
  earned_score: score,
  maximum_score: 100,
  weight,
  category_id: null,
  dropped: false,
  submission_state: "unknown",
  verification_status: "verified",
});
describe("academic integrity and verified source mappings", () => {
  it("does not call a partial or unverified inventory an overall grade", () => {
    expect(
      academicGrade("points", [assessment("a", 80, null)]).overall_grade,
    ).toBeNull();
    expect(
      academicGrade(
        "points",
        [{ ...assessment("a", 80, null), verification_status: "unverified" }],
        [],
        { inventoryComplete: true, rulesVerified: true },
      ).overall_grade,
    ).toBeNull();
    expect(
      academicGrade("points", [assessment("a", 80, null)], [], {
        inventoryComplete: false,
        rulesVerified: true,
      }).warnings.join(" "),
    ).toMatch(/inventory/);
  });
  it("keeps unknown grades out of the denominator and refuses an overall grade with incomplete weights", () => {
    const result = academicGrade("assessment_weights", [
      assessment("a", 80, 25),
      assessment("b", null, 75),
    ]);
    expect(result.graded_average).toBe(80);
    expect(result.overall_grade).toBeNull();
    expect(result.missing_scores).toBe(1);
    expect(
      academicGrade("unknown", [assessment("a", 80, 25)]).graded_average,
    ).toBeNull();
    expect(
      academicGrade("assessment_weights", [assessment("a", 80, null)])
        .overall_grade,
    ).toBeNull();
  });
  it("calculates final grades only when the selected formula and all required scores are present", () => {
    expect(
      academicGrade(
        "assessment_weights",
        [assessment("a", 80, 25), assessment("b", 100, 75)],
        [],
        { inventoryComplete: true, rulesVerified: true },
      ).overall_grade,
    ).toBe(95);
    const a = { ...assessment("a", 50, null), maximum_score: 50 };
    const b = { ...assessment("b", 50, null), maximum_score: 100 };
    expect(
      academicGrade("points", [a, b], [], {
        inventoryComplete: true,
        rulesVerified: true,
      }).overall_grade,
    ).toBeCloseTo((100 / 150) * 100);
  });
  it("honours configured category dropping without treating unknown scores as zero", () => {
    const categories = [
      {
        id: "category",
        weight: 100,
        drop_lowest_count: 1,
        aggregation: "equal_items" as const,
      },
    ];
    const list = [assessment("a", 20, null), assessment("b", 80, null)].map(
      (x) => ({ ...x, category_id: "category" }),
    );
    expect(
      academicGrade("category_weights", list, categories, {
        inventoryComplete: true,
        rulesVerified: true,
      }).overall_grade,
    ).toBe(80);
    const incomplete = [
      ...list,
      { ...assessment("c", null, null), category_id: "category" },
    ];
    expect(
      academicGrade("category_weights", incomplete, categories).overall_grade,
    ).toBeNull();
  });
  it("allows unknown term dates and rejects two competing assessment deadlines", () => {
    expect(
      academicSchemas.academic_terms.parse({ name: "[TEST] Term" }).start_date,
    ).toBeNull();
    expect(() =>
      academicSchemas.assessments.parse({
        course_id: "11111111-1111-4111-8111-111111111111",
        title: "[TEST]",
        due_date: "2026-11-06",
        due_at: "2026-11-06T12:00:00Z",
      }),
    ).toThrow();
  });
  it("fails closed when spreadsheet headers change instead of guessing", () => {
    expect(() =>
      mapAcademicSnapshot(
        {
          id: "synthetic",
          title: "[TEST]",
          tabs: [],
          fingerprint: "synthetic",
        },
        { terms: [], courses: [], assessments: [], topics: [] },
      ),
    ).toThrow(/Missing source tab/);
    const mapped = mapCareerSnapshot({
      id: "synthetic",
      title: "[TEST]",
      tabs: [],
      fingerprint: "synthetic",
    });
    expect(mapped.records).toHaveLength(0);
    expect(mapped.errors.length).toBeGreaterThan(0);
  });
});
