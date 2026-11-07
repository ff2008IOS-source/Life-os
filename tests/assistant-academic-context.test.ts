import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  academicContext,
  prioritizeAssistantSources,
  type AcademicCandidate,
} from "../src/lib/assistant/academic-context";
import { boundedPrompt } from "../src/lib/assistant/provider";
const now = new Date("2026-11-07T08:00:00Z");
const a = (
  id: string,
  course: string,
  title: string,
  due_at: string | null,
): AcademicCandidate => ({
  id,
  course_id: course,
  course,
  title,
  due_at,
  verification: "Canvas-retrieved",
  description: "<p>Chapters 4–6. No other coverage confirmed.</p>",
  url: "/canvas-materials",
});
const data = [
  a("old", "ECON 115", "Exam 1", "2026-10-01T20:00Z"),
  a("later", "PSYC 100", "Midterm 2", "2026-11-13T20:00Z"),
  a("next", "ECON 115", "Exam 2", "2026-11-09T20:00Z"),
  a("quiz", "PHIL 100W", "Reading quiz", "2026-11-08T20:00Z"),
  a("unknown", "GEOG 104", "Final exam", null),
];
it("finds the nearest recorded exam across courses without requiring a selected course", () => {
  const result = academicContext("What's on my next test?", data, now);
  expect(result.focus?.id).toBe("next");
  expect(result.unknown_deadlines).toBe(1);
  expect(result.sources[1].text).toContain("Chapters 4–6");
  expect(JSON.parse(result.sources[0].text).searched_course_count).toBe(4);
  const prompt = boundedPrompt("What's on my next test?", result.sources);
  expect(prompt.sources.some((s) => s.id === "next")).toBe(true);
  expect(prompt.messages[1].content).toContain("Exam 2");
});
it("understands a course mentioned naturally and keeps same-title external identities distinct", () => {
  expect(
    academicContext("What is my next PSYC100 exam?", data, now).focus?.id,
  ).toBe("later");
  expect(
    academicContext(
      "PSYC100 exam",
      [a("section", "PSYC100 D100", "Midterm", "2026-11-13T20:00Z")],
      now,
    ).focus?.id,
  ).toBe("section");
  const result = academicContext(
    "next exam",
    [
      a("one", "ECON 115", "Exam", "2026-11-09T20:00Z"),
      a("two", "ECON 115", "Exam", "2026-11-12T20:00Z"),
    ],
    now,
  );
  expect(result.upcoming).toHaveLength(2);
});
it("does not infer dates, completion or full exam coverage, and uses Vancouver date-only deadlines", () => {
  const result = academicContext(
    "next exam",
    [
      ...data,
      { ...a("date", "ECON 113", "Test", null), due_date: "2026-11-07" },
    ],
    now,
  );
  expect(result.focus?.id).toBe("date");
  expect(result.sources[0].text).toContain("never inferred");
  expect(result.sources[0].text).toContain("unknown_deadlines");
  const missing = academicContext(
    "next exam",
    [a("unknown", "GEOG104", "Final exam", null)],
    now,
  );
  expect(missing.focus).toBeUndefined();
  expect(missing.unknown_deadlines).toBe(1);
});

it("prioritizes the asked domain rather than letting academic records consume every conversation", () => {
  const academic = academicContext("next exam", data, now).sources;
  const goal = {
    id: "goal:1",
    title: "NBA goal",
    text: "Recorded career progress",
    url: "/goals",
  };
  expect(
    prioritizeAssistantSources("my career goals", [...academic, goal])[0].id,
  ).toBe("goal:1");
  expect(
    prioritizeAssistantSources("my next exam", [goal, ...academic])[0].id,
  ).toBe("academics:upcoming");
});

it("does not mislabel an earlier final project as an exam", () => {
  const r = academicContext(
    "my next final",
    [...data, a("project", "PSYC100", "Final project", "2026-11-08T20:00Z")],
    now,
  );
  expect(r.focus).toBeUndefined();
});

it("does not call an unverified Exam 2 a confirmed midterm, or mix in unrelated knowledge tests", () => {
  const r = academicContext(
    "What about my next midterm?",
    [
      {
        ...a("candidate", "ECON 115", "Exam 2", null),
        due_date: "2026-11-13",
        verification: "unverified",
      },
      a("geog", "GEOG104", "Knowledge Test #2", "2026-11-09T06:59:59Z"),
    ],
    now,
  );
  expect(r.focus).toBeUndefined();
  expect(r.materialFocus?.id).toBe("candidate");
  expect(r.sources[1].text).toContain("UNVERIFIED");
  expect(r.sources[1].text).toContain("Friday, Nov 13");
  expect(r.sources[1].text).not.toContain("GEOG");
});
it("formats Canvas due dates in Vancouver and excludes practice or makeup items from next-exam lookup", () => {
  const r = academicContext(
    "next test",
    [
      a("geog", "GEOG104", "Knowledge Test #2", "2026-11-09T06:59:59Z"),
      a("practice", "ECON115", "Practice Exam", "2026-11-08T01:00Z"),
    ],
    now,
  );
  expect(r.focus?.id).toBe("geog");
  expect(r.sources[1].text).toContain("Sunday, Nov 8");
  expect(r.sources[1].text).toContain("not necessarily exam start");
});
