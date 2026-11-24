import { expect, it } from "vitest";
import { recapText, weekRecap } from "@/lib/week-recap";

const base = {
  weekStart: "2026-11-23",
  weekEnd: "2026-11-29",
  goals: [{ id: "g", title: "Learn Excel foundations", status: "active" }],
  milestones: [],
  goalTasks: [{ goal_id: "g", task_id: "t1" }],
  courses: [{ id: "c", code: "ECON 113" }],
  topics: [
    {
      id: "p1",
      course_id: "c",
      title: "Elasticity",
      mastery: "practicing",
      updated_at: "2026-11-25T20:00:00Z",
    },
    {
      id: "p2",
      course_id: "c",
      title: "Old",
      mastery: "practicing",
      updated_at: "2026-11-10T20:00:00Z",
    },
  ],
  sessions: [
    {
      id: "s",
      course_id: "c",
      start_at: "2026-11-24T03:00:00Z",
      actual_minutes: 45,
    },
  ],
};

it("fills a week from recorded work only", () => {
  const r = weekRecap({
    ...base,
    tasks: [
      {
        id: "t1",
        title: "Excel module 3",
        completed_at: "2026-11-24T22:00:00Z",
      },
      { id: "t2", title: "Last week", completed_at: "2026-11-20T22:00:00Z" },
    ],
    assessments: [
      {
        id: "a",
        course_id: "c",
        title: "Quiz 4",
        due_date: "2026-11-25",
        submission_state: "returned",
        earned_score: 9,
        maximum_score: 10,
      },
      {
        id: "b",
        course_id: "c",
        title: "Problem set",
        due_date: "2026-11-26",
        submission_state: "submitted",
        earned_score: null,
        maximum_score: 20,
      },
      {
        id: "z",
        course_id: "c",
        title: "Next week",
        due_date: "2026-12-02",
        submission_state: "unknown",
      },
    ],
  });
  expect(r.tasksDone).toEqual(["Excel module 3"]);
  expect(r.deadlines).toMatchObject({ handled: 2, total: 2 });
  expect(r.marks).toEqual([
    { title: "Quiz 4", course: "ECON 113", percent: 90 },
  ]);
  expect(r.goalsMoved).toEqual(["Learn Excel foundations"]);
  expect(r.topicsImproved).toEqual(["ECON 113 · Elasticity"]);
  expect(r.studyMinutes).toBe(45);
  const text = recapText(r);
  expect(text).toContain("Handled 2 of 2 deadlines.");
  expect(text).toContain("ECON 113 Quiz 4 90%");
  expect(text).toContain("Goals moved forward: Learn Excel foundations.");
});

it("stays empty when nothing was recorded", () => {
  const r = weekRecap({
    ...base,
    topics: [],
    sessions: [],
    tasks: [],
    assessments: [],
  });
  expect(recapText(r)).toBe("");
});
