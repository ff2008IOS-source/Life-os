import { expect, it } from "vitest";
import {
  assessmentStatus,
  reconcileAssessments,
} from "@/lib/assessment-identity";
const row = (
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  title,
  course_id: "psyc",
  source_key: id === "summary" ? "sheet:summary" : `canvas:1:${id}`,
  earned_score: null,
  maximum_score: null,
  submission_state: "unknown",
  ...extra,
});
it("matches Exam 2 to MC/short-answer without double-counting, preserving source details and weight", () => {
  const raw = [
    row("summary", "Exam 2", { weight: 25 }),
    row("mc", "Exam 2 - Multiple Choice", {
      earned_score: 64,
      maximum_score: 80,
      submission_state: "returned",
    }),
    row("sa", "Exam 2 - Short Answer", {
      earned_score: 21,
      maximum_score: 45,
      submission_state: "returned",
    }),
    row("makeup", "Exam 2 Makeups"),
  ];
  const before = structuredClone(raw);
  const r = reconcileAssessments(raw);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({
    id: "summary",
    earned_score: 85,
    maximum_score: 125,
    weight: 25,
    submission_state: "returned",
  });
  expect(r[0].components).toHaveLength(2);
  expect(r[0].alternatives).toHaveLength(1);
  expect(assessmentStatus(r[0])).toBe("Graded");
  expect(raw).toEqual(before);
  expect(reconcileAssessments(r)).toEqual(r);
});
it("retains conflicting official and component results rather than inventing agreement", () => {
  const r = reconcileAssessments([
    row("summary", "Exam 1", { earned_score: 90, maximum_score: 100 }),
    row("mc", "Exam 1 - Multiple Choice", {
      earned_score: 66,
      maximum_score: 80,
    }),
    row("sa", "Exam 1 - Short Answer", { earned_score: 37, maximum_score: 45 }),
  ]);
  expect(r[0]).toMatchObject({
    earned_score: 90,
    maximum_score: 100,
    score_conflict: true,
  });
  expect(assessmentStatus(r[0])).toBe("Results need review");
});
it("reports partial parts and never turns unknown scores into zero", () => {
  const r = reconcileAssessments([
    row("summary", "Exam 3"),
    row("mc", "Exam 3 - Multiple Choice", {
      earned_score: 0,
      maximum_score: 80,
    }),
    row("sa", "Exam 3 - Short Answer", { maximum_score: 45 }),
  ]);
  expect(r[0].earned_score).toBeNull();
  expect(assessmentStatus(r[0])).toBe("1 of 2 parts graded");
});
it("matches broad numbered assignments and parenthetical instructions within one course", () => {
  expect(
    reconcileAssessments([
      row("summary", "ZAPS 1"),
      row("z", "ZAPS 1: Split Brain", { earned_score: 1.96, maximum_score: 2 }),
    ]),
  ).toHaveLength(1);
  expect(
    reconcileAssessments([
      row("summary", "Research Participation"),
      row("r", "Research Participation (Complete by end of term)"),
    ]),
  ).toHaveLength(1);
});
it("keeps different courses, numbers, attempts, same-source rows and ambiguous parts separate", () => {
  for (const rows of [
    [row("summary", "Exam 1"), row("x", "Exam 2")],
    [row("summary", "Exam 2"), row("x", "Exam 2", { course_id: "other" })],
    [row("a", "Essay"), row("b", "Essay")],
    [
      row("summary", "Exam 2"),
      row("a", "Exam 2 Multiple Choice"),
      row("b", "Exam 2 Multiple Choice"),
      row("s", "Exam 2 Short Answer"),
    ],
  ])
    expect(reconcileAssessments(rows)).toHaveLength(rows.length);
});

it("does not treat an explicitly missing zero-marked section as a completed exam", () => {
  const [exam] = reconcileAssessments([
    row("summary", "Exam 2"),
    row("mc", "Exam 2 Multiple Choice", {
      earned_score: 64,
      maximum_score: 80,
      submission_state: "returned",
    }),
    row("sa", "Exam 2 Short Answer", {
      earned_score: 0,
      maximum_score: 45,
      submission_state: "not_submitted",
    }),
  ]);
  expect(exam.score_conflict).toBe(true);
  expect(exam.submission_state).not.toBe("returned");
  expect(exam.earned_score).toBeNull();
  expect(assessmentStatus(exam)).toBe("Results need review");
});
