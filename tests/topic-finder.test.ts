import { describe, expect, it } from "vitest";
import {
  covers,
  dedupeTopics,
  headingTopics,
  normalizeTopic,
  topicReply,
  topicSignal,
} from "@/lib/topic-finder";

const now = new Date("2026-11-25T20:00:00Z");

describe("finding topics", () => {
  it("normalises titles so duplicates are caught", () => {
    expect(normalizeTopic("Chapter 10: Stress and Health")).toBe(
      "stress health",
    );
    expect(normalizeTopic("The Market for Loanable Funds")).toBe(
      "market loanable funds",
    );
  });
  it("drops topics that already exist or repeat", () => {
    const out = dedupeTopics(
      [
        { title: "Market for loanable funds", section: "Week 6" },
        { title: "market for LOANABLE funds", section: "" },
        { title: "Classical conditioning", section: "Ch 6" },
        { title: "GDP", section: "" },
      ],
      ["The market for loanable funds"],
    );
    expect(out.map((t) => t.title)).toEqual(["Classical conditioning", "GDP"]);
  });
  it("falls back to titled headings without AI", () => {
    const t = headingTopics(
      "Overview  Chapter 6: Learning and Conditioning  Lecture 7 – Memory Systems  Grading policy",
    );
    expect(t.map((x) => x.title)).toEqual([
      "Learning and Conditioning",
      "Memory Systems",
    ]);
    expect(t[0].section).toBe("Chapter 6");
  });
  it("validates the AI reply shape strictly", () => {
    expect(
      topicReply.safeParse({ topics: [{ title: "Elasticity", section: "" }] })
        .success,
    ).toBe(true);
    expect(topicReply.safeParse({ topics: [{ title: "x" }] }).success).toBe(
      false,
    );
  });
});

describe("topic evidence", () => {
  const topic = {
    id: "t",
    title: "Stress and health",
    mastery: "practicing" as const,
    notes: "Chapter 10",
  };
  it("matches assessments by chapter", () => {
    expect(covers("InQuizitive: Chapter 10: Stress and Health", topic)).toBe(
      true,
    );
    expect(covers("InQuizitive: Chapter 9: Motivation", topic)).toBe(false);
  });
  it("a low matched score means Needs review, with the score as the reason", () => {
    const s = topicSignal({
      topic,
      assessments: [
        { title: "Quiz Ch. 10", earned_score: 6, maximum_score: 10 },
      ],
      sessions: [],
      now,
    });
    expect(s).toEqual({
      suggest: "needs_review",
      reason: "Quiz Ch. 10: 60%",
      urgent: true,
    });
  });
  it("flags an upcoming exam without changing the status", () => {
    const s = topicSignal({
      topic,
      assessments: [
        {
          title: "Chapter 10 quiz",
          earned_score: null,
          maximum_score: 10,
          due_date: "2026-12-01",
        },
      ],
      sessions: [],
      now,
    });
    expect(s.suggest).toBeNull();
    expect(s.reason).toMatch(/Chapter 10 quiz in \d days/);
    expect(s.urgent).toBe(true);
  });
  it("a logged session moves an unstudied topic to Practicing, never to Mastered", () => {
    const s = topicSignal({
      topic: { ...topic, mastery: "unstudied" },
      assessments: [],
      sessions: [{ topic_id: "t", start_at: "2026-11-24T18:00:00Z" }],
      now,
    });
    expect(s.suggest).toBe("practicing");
  });
  it("practice goes stale after two weeks", () => {
    const s = topicSignal({
      topic: { ...topic, updated_at: "2026-11-01T00:00:00Z" },
      assessments: [],
      sessions: [],
      now,
    });
    expect(s.suggest).toBe("needs_review");
    expect(s.reason).toMatch(/Not reviewed in 2\d days/);
  });
});

describe("course order", () => {
  it("reads week, unit, chapter, day and exam hints", async () => {
    const { courseOrder } = await import("@/lib/topic-finder");
    expect(
      courseOrder({
        notes: "Units 8.0-8.5 · From Lecture Week 10_Econ113.pptx",
      }),
    ).toBe(10);
    expect(
      courseOrder({
        notes: "Unit 1: Sections 1-1.6 · From Lecture Week 1_Econ 113.pptx",
      }),
    ).toBe(1);
    expect(
      courseOrder({ notes: "Week 4b · From Lecture Week 4_Econ113.pptx" }),
    ).toBeCloseTo(4.2);
    expect(
      courseOrder({ notes: "Course: ECON 113 | Unit / Week: Day 2" }),
    ).toBe(2);
    expect(courseOrder({ notes: "Unit / Week: Exam 1 prep" })).toBe(4.5);
    expect(
      courseOrder({ notes: "Short Answers · From Answer Key mt 2 sp19.pdf" }),
    ).toBe(9);
    expect(courseOrder({ notes: "Unit / Week: Mock / remaining" })).toBe(50);
    expect(courseOrder({ notes: "" })).toBe(Infinity);
  });
  it("orders week 1, then 2, then 10, unknown last", async () => {
    const { byCourseOrder } = await import("@/lib/topic-finder");
    const out = byCourseOrder([
      { title: "c", notes: "From Lecture Week 10.pptx" },
      { title: "x", notes: "" },
      { title: "a", notes: "Week 1" },
      { title: "b2", notes: "Week 2b" },
      { title: "b1", notes: "Week 2a" },
    ]);
    expect(out.map((t) => t.title)).toEqual(["a", "b1", "b2", "c", "x"]);
  });
});
