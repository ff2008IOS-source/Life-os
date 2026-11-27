import { describe, expect, it } from "vitest";
import { gradeParts } from "@/lib/academic-grades";

const a = (over: Record<string, unknown>) => ({
  id: String(Math.random()),
  category_id: null,
  weight: null,
  maximum_score: 100,
  earned_score: null,
  dropped: false,
  submission_state: "unknown",
  ...over,
});

describe("grade ring parts", () => {
  it("uses each assessment's syllabus weight; unscored parts stay unknown", () => {
    expect(
      gradeParts("assessment_weights", [
        a({ title: "Exam 1", weight: 40, earned_score: 88 }),
        a({ title: "Exam 2", weight: 40, earned_score: 53.5 }),
        a({ title: "Exam 3", weight: 15 }),
        a({ title: "Canvas copy", weight: null, maximum_score: 105 }),
        a({ title: "Dropped", weight: 5, dropped: true }),
      ]),
    ).toEqual([
      { label: "Exam 1", weight: 40, score: 0.88 },
      { label: "Exam 2", weight: 40, score: 0.535 },
      { label: "Exam 3", weight: 15, score: null },
    ]);
  });
  it("groups by weighted category, ignoring placeholder zeros", () => {
    const parts = gradeParts(
      "category_weights",
      [
        a({ category_id: "q", earned_score: 8, maximum_score: 10 }),
        a({ category_id: "q", earned_score: 6, maximum_score: 10 }),
        a({ category_id: "e", earned_score: 0, submission_state: "submitted" }),
      ],
      [
        {
          id: "q",
          name: "Quizzes",
          weight: 30,
          drop_lowest_count: 0,
          aggregation: "points",
        },
        {
          id: "e",
          name: "Exams",
          weight: 70,
          drop_lowest_count: 0,
          aggregation: "points",
        },
      ],
    );
    expect(parts).toEqual([
      { label: "Quizzes", weight: 30, score: 0.7 },
      { label: "Exams", weight: 70, score: null },
    ]);
  });
});
