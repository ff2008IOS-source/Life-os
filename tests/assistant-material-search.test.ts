import { it, expect } from "vitest";
import { materialRelevance } from "../src/lib/assistant/material-search";
it("finds scope inside a long page body even when the title is not an exam title", () => {
  const body =
    "<p>" +
    "Welcome to economics. ".repeat(120) +
    "Exam 2 covers chapters 7 and 8. Review inflation and unemployment.</p>";
  const r = materialRelevance(
    "Course information",
    body,
    "What topics are on my next midterm?",
    "Exam 2",
  );
  expect(r.score).toBeGreaterThan(0);
  expect(r.excerpt).toContain("covers chapters 7 and 8");
});
it("rejects another numbered exam page rather than borrowing its coverage", () => {
  expect(
    materialRelevance(
      "Exam 1",
      "Covers chapters 1–3",
      "What is on Exam 2?",
      "Exam 2",
    ).score,
  ).toBe(0);
});
