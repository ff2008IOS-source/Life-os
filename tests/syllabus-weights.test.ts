import { describe, it, expect } from "vitest";
import { extractSyllabusWeights, matchWeightRow } from "@/lib/syllabus-weights";

// Grading lines as they appear in extracted Fall 2026 syllabus text.
const econ113 =
  "This will ultimately help us understand supply and demand. Grading: Participation and attendance in tutorials (10%), Midterm exam (40%) Final exam (cumulative) (50%) Note: The Final course grading policy adopted by the economics department can be found here. If you miss the midterm your final exam will be worth 90% of your total grade.";
const psyc100 =
  "SUMMARY OF ASSIGNMENTS AND GRADING ASSIGNMENTS AND GRADING SUMMARY (Additional details available later in this document and on the course Canvas site) Assignments Overall Points (Percentage of Grade) InQuizitives (10 x 1pt each) 10 pts (2%) ZAPs (6 x 2pts each; lowest dropped) 10 pts (2%) Comparative Psych Assignment 75 pts (15%) Exams (3 x 125pts each) 375 pts (75%) Research Participation 30 pts (6%) Total: 500 points (100%) Bonus points possible";
const geog104 =
  "Microsoft Office software. Available for free download from SFU; see link on Canvas. Assessment Learning check-ins 11% Climate change conversations 9% Knowledge applications 25% Knowledge tests 30% Course synthesis exercise: Climate change solutions memo 25% Evaluation 95 ≤ A+ Knowledge Applications (3 x 6% + 1 x 7% = 25%)";
const phil100w =
  "Tue, 4:30 – 5:20 p.m. Kaitlin AQ 5051 22 Sep GRADING Your final grade will be calculated using the weightings in the table below. Graded questions in tutorials: 10% First paper 30% Second paper 30% Final exam: 30% You will write a first draft of your first paper";

describe("extractSyllabusWeights", () => {
  it("reads ECON 113", () => {
    expect(extractSyllabusWeights(econ113)).toEqual([
      { name: "Participation and attendance in tutorials", weight: 10 },
      { name: "Midterm exam", weight: 40 },
      { name: "Final exam", weight: 50 },
    ]);
  });
  it("reads PSYC 100's points table", () => {
    expect(extractSyllabusWeights(psyc100)).toEqual([
      { name: "InQuizitives", weight: 2 },
      { name: "ZAPs", weight: 2 },
      { name: "Comparative Psych Assignment", weight: 15 },
      { name: "Exams", weight: 75 },
      { name: "Research Participation", weight: 6 },
    ]);
  });
  it("reads GEOG 104", () => {
    expect(extractSyllabusWeights(geog104)?.map((r) => r.weight)).toEqual([
      11, 9, 25, 30, 25,
    ]);
    expect(extractSyllabusWeights(geog104)?.[0].name).toBe(
      "Learning check-ins",
    );
    expect(extractSyllabusWeights(geog104)?.[4].name).toMatch(
      /^Course synthesis exercise/,
    );
  });
  it("reads PHIL 100W", () => {
    expect(extractSyllabusWeights(phil100w)).toEqual([
      { name: "Graded questions in tutorials", weight: 10 },
      { name: "First paper", weight: 30 },
      { name: "Second paper", weight: 30 },
      { name: "Final exam", weight: 30 },
    ]);
  });
  it("returns null rather than guessing", () => {
    expect(extractSyllabusWeights("Late work loses 5% per day.")).toBeNull();
    expect(extractSyllabusWeights("Quizzes 20% Midterm 30%")).toBeNull();
  });
});

it("matches assessments and Canvas groups to syllabus rows", () => {
  const rows = extractSyllabusWeights(psyc100)!;
  expect(matchWeightRow("Exam 2", rows)).toBe(3);
  expect(matchWeightRow("InQuizitive: Chapter 7: Memory", rows)).toBe(0);
  expect(matchWeightRow("ZAPS 5: Serial Position Effect", rows)).toBe(1);
  expect(matchWeightRow("Comparative Psychology Assignment", rows)).toBe(2);
  expect(matchWeightRow("Bonus Survey 1", rows)).toBeNull();
});
