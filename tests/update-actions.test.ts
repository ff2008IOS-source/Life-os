import { expect, it } from "vitest";
import {
  actionFor,
  assessmentKeys,
  deadlineDate,
  movedDate,
  type ActionAssessment,
} from "@/lib/update-actions";

const econ = "c-econ";
const a = (x: Partial<ActionAssessment>): ActionAssessment => ({
  id: "a",
  course_id: econ,
  title: "Exam 2",
  due_at: null,
  due_date: null,
  earned_score: null,
  maximum_score: 100,
  source_key: null,
  ...x,
});
const msg = (
  title: string,
  body: string,
  flags: string[],
  course_id: string | null = econ,
) => ({
  id: "m",
  course_id,
  title,
  body,
  flags,
  posted_at: "2026-11-25T18:00:00Z",
});

it("reads assessment names", () => {
  expect(assessmentKeys("ECON115 – Grades available: Exam 2")).toEqual([
    "exam 2",
  ]);
  expect(assessmentKeys("Quiz #4 and the Final Exam")).toEqual([
    "quiz 4",
    "final",
  ]);
});

it("reads moved and deadline dates", () => {
  expect(
    movedDate(
      "Exam 3 is rescheduled to Friday, December 4.",
      "2026-11-25T00:00:00Z",
    ),
  ).toBe("2026-12-04");
  expect(
    movedDate("The quiz has moved to Jan 12", "2026-12-10T00:00:00Z"),
  ).toBe("2027-01-12");
  expect(
    movedDate("Office hours this week", "2026-11-25T00:00:00Z"),
  ).toBeNull();
  expect(
    deadlineDate("Your library items are due Dec 3", "2026-11-25T00:00:00Z"),
  ).toBe("2026-12-03");
});

it("a Crowdmark mark asks for the score unless it's already in", () => {
  const m = msg(
    "(Fall 2026) ECON115 – Grades available: Exam 2",
    "Your feedback and scores are ready.",
    ["mark"],
  );
  expect(actionFor(m, [a({})], "2026-11-26")).toEqual({
    kind: "enter_mark",
    assessment_id: "a",
    assessment: "Exam 2",
    maximum: 100,
  });
  expect(actionFor(m, [a({ earned_score: 53.5 })], "2026-11-26")).toEqual({
    kind: "mark_recorded",
    assessment: "Exam 2",
    percent: 53.5,
  });
  // The syllabus record wins over a blank Canvas copy.
  expect(
    actionFor(
      m,
      [a({ id: "canvas", source_key: "canvas:1:2" }), a({ id: "syllabus" })],
      "2026-11-26",
    ),
  ).toMatchObject({ assessment_id: "syllabus" });
  expect(
    actionFor(msg("Grades are posted", "", ["mark"]), [], "2026-11-26"),
  ).toEqual({ kind: "open_grades" });
});

it("a moved exam offers the new date only when it differs and is ahead", () => {
  const m = msg("Exam 3 moved", "Exam 3 is moved to December 9 in AQ 3150.", [
    "schedule",
  ]);
  const exam3 = a({ id: "e3", title: "Exam 3", due_date: "2026-12-04" });
  expect(actionFor(m, [exam3], "2026-11-26")).toEqual({
    kind: "move_date",
    assessment_id: "e3",
    assessment: "Exam 3",
    from: "2026-12-04",
    to: "2026-12-09",
  });
  expect(
    actionFor(m, [{ ...exam3, due_date: "2026-12-09" }], "2026-11-26"),
  ).toBeNull();
});

it("grading changes point to the rules; personal deadlines become tasks", () => {
  expect(
    actionFor(
      msg("Update", "The lowest quiz will be dropped", ["grading"]),
      [],
      "2026-11-26",
    ),
  ).toEqual({ kind: "check_rules" });
  expect(
    actionFor(
      msg("Due Items", "Your library items are due Dec 3.", [], null),
      [],
      "2026-11-26",
    ),
  ).toEqual({ kind: "add_task", title: "Due Items", due_date: "2026-12-03" });
  expect(
    actionFor(
      msg("Due Items", "Your library items were due Nov 3.", [], null),
      [],
      "2026-11-26",
    ),
  ).toBeNull();
  expect(
    actionFor(
      msg("Residence drill", "This Tuesday", [], null),
      [],
      "2026-11-26",
    ),
  ).toBeNull();
});

it("Canvas mark notifications need nothing from you; Crowdmark ones do", () => {
  const canvas = msg(
    "Submission Posted: Knowledge Application 2, GEOG104 OL01 Climate Change",
    "https://canvas.sfu.ca/courses/123/assignments/456",
    ["mark"],
  );
  expect(actionFor(canvas, [], "2026-11-26")).toBeNull();
  expect(
    actionFor(
      msg(
        "Grades available: Lab report",
        "Sign in to Canvas and click the Crowdmark link",
        ["mark"],
      ),
      [],
      "2026-11-26",
    ),
  ).toEqual({ kind: "open_grades" });
});
