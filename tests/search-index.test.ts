import { it, expect } from "vitest";
import { buildSearchIndex, searchEntries } from "@/lib/search-index";
const index = buildSearchIndex({
  tasks: [
    { id: "t1", title: "Talk to Anees", status: "inbox" },
    { id: "t2", title: "Old exam notes", status: "completed" },
    { id: "t3", title: "Deleted", status: "inbox", deleted_at: "2026-11-01" },
  ],
  projects: [{ id: "p1", name: "SFU Hoops Dashboard" }],
  goals: [{ id: "g1", title: "Learn Excel foundations", status: "active" }],
  academic: {
    courses: [
      { id: "c1", code: "PSYC 100", title: "Introduction to Psychology" },
    ],
    assessments: [
      { id: "a1", course_id: "c1", title: "Exam 1" },
      { id: "a2", course_id: "c1", title: "Cumulative final exam" },
      { id: "a3", course_id: "c1", title: "Dropped exam", dropped: true },
    ],
    study_topics: [{ id: "s1", course_id: "c1", title: "Weber's law" }],
  },
});
it("finds assessments and links straight to them", () => {
  const r = searchEntries(index, "Exam");
  expect(r[0]).toMatchObject({
    kind: "Assessment",
    title: "Exam 1",
    href: "/areas/academics?course=c1&assessment=a1",
  });
  expect(r.map((e) => e.title)).toContain("Cumulative final exam");
  expect(r.map((e) => e.title)).not.toContain("Dropped exam");
  // Completed tasks rank after live records.
  const titles = r.map((e) => e.title);
  expect(titles.indexOf("Old exam notes")).toBeGreaterThan(
    titles.indexOf("Cumulative final exam"),
  );
});
it("matches every word across title, course and kind", () => {
  expect(searchEntries(index, "psyc exam").map((e) => e.title)).toEqual([
    "Exam 1",
    "Cumulative final exam",
  ]);
  expect(searchEntries(index, "weber")[0].href).toBe(
    "/areas/academics?course=c1&view=study",
  );
});
it("covers pages, settings, tasks, projects and goals", () => {
  expect(searchEntries(index, "reconnect")[0].href).toBe(
    "/settings?section=integrations",
  );
  expect(searchEntries(index, "planner")[0].title).toBe("Week planner");
  expect(searchEntries(index, "anees")[0].href).toBe(
    "/planner?section=tasks&task=t1",
  );
  expect(searchEntries(index, "hoops")[0].href).toBe(
    "/areas/projects#project-p1",
  );
  expect(searchEntries(index, "excel")[0].href).toBe("/goals#goal-g1");
  expect(searchEntries(index, "deleted")).toEqual([]);
  expect(searchEntries(index, "  ")).toEqual([]);
});
