import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fileRelevance } from "../src/lib/canvas/documents-server";
import { guardAcademicReply } from "../src/lib/assistant/provider";
it("prioritizes the real course file over an older paper from a different numbered course", () => {
  expect(
    fileRelevance(
      "Economics 105 Midterm 2 Sp19.pdf",
      "next midterm",
      "Exam 2",
      "ECON115",
    ),
  ).toBe(-1000);
  expect(
    fileRelevance(
      "Econ 115 Mid 2 (1).pdf",
      "next midterm",
      "Exam 2",
      "ECON115",
    ),
  ).toBeGreaterThan(
    fileRelevance(
      "Economics 115 Exam 2 Answer Key Fall 2023.pdf",
      "next midterm",
      "Exam 2",
      "ECON115",
    ),
  );
});
it("does not let a tentative disclaimer excuse a contradictory confirmed-midterm claim", () => {
  const response = guardAcademicReply(
    "what should i study for my next midterm",
    {
      answer:
        "This is tentative. The next confirmed midterm is ECON 115 Exam 2, due Friday, Nov 13, 2026.",
      source_ids: [],
      unknowns: [],
      next_actions: [],
    },
    [
      {
        id: "academics:upcoming",
        title: "Lookup",
        url: "/academics",
        text: JSON.stringify({ explicit_midterm_identified: false }),
      },
      {
        id: "assessment:a",
        title: "ECON115 Exam2",
        url: "/academics",
        text: JSON.stringify({
          course: "ECON115",
          title: "Exam 2",
          deadline_local: "Friday, Nov 13, 2026",
          verification: "UNVERIFIED imported record",
        }),
      },
    ],
  );
  expect(response.answer).not.toMatch(/confirmed midterm/);
  expect(response.answer).toContain("unverified");
  expect(response.answer).toContain("can’t confirm");
});
