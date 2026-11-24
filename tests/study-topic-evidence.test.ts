import { describe, it, expect } from "vitest";
import {
  parseTopicReply,
  studyTopicEvidence,
} from "../src/lib/study-topic-evidence";
const file = "Week 2 slides.pdf";
const t = { title: "Working memory", source_file: file, section: "Week 2" };
it("validates the response and retains distinct concepts grounded in this source", () => {
  const topics = [
    t,
    { ...t, title: "working-memory" },
    { ...t, title: "Not present" },
    { ...t, source_file: "other.pdf" },
  ];
  expect(parseTopicReply({ topics }, file, "Working memory")).toEqual([t]);
  expect(
    parseTopicReply({ topics }, file, "Working memory", ["Working: memory"]),
  ).toEqual([]);
  expect(() =>
    parseTopicReply({ topics: [{ title: "X" }] }, file, "X"),
  ).toThrow();
});
describe("topic evidence", () => {
  const topic = {
    id: "a",
    course_id: "c",
    mastery: "unstudied",
    title: "Working memory",
    section: "Ch. 10, Week 2",
    source_folder: "Exam 3",
  };
  const now = new Date("2026-11-16T06:30:00Z");
  const quiz = {
    course_id: "c",
    title: "InQuizitive Ch. 10",
    earned_score: 6,
    maximum_score: 10,
    due_date: "2026-11-01",
  };
  const session = {
    course_id: "c",
    topic_id: "a",
    end_at: "2026-11-15T22:00:00Z",
  };
  it("matches chapter and title with a strict 70 percent cutoff", () => {
    expect(studyTopicEvidence(topic, [quiz], [], now)).toEqual({
      mastery: "needs_review",
      reason: "InQuizitive Ch. 10: 60%",
    });
    for (const changed of [
      { earned_score: 7 },
      { earned_score: null },
      { title: "Ch. 1" },
      { course_id: "d" },
    ])
      expect(
        studyTopicEvidence(topic, [{ ...quiz, ...changed }], [], now).mastery,
      ).toBe("unstudied");
    expect(
      studyTopicEvidence(
        topic,
        [{ ...quiz, title: "Quiz: Working memory" }],
        [],
        now,
      ).mastery,
    ).toBe("needs_review");
  });
  it("uses the latest matched event and respects manual mastery", () => {
    expect(studyTopicEvidence(topic, [quiz], [session], now)).toEqual({
      mastery: "practicing",
      reason: "Studied today",
    });
    expect(
      studyTopicEvidence(topic, [quiz], [{ ...session, topic_id: "b" }], now)
        .mastery,
    ).toBe("needs_review");
    expect(
      studyTopicEvidence(
        { ...topic, mastery_manual: true, mastery: "mastered" },
        [quiz],
        [session],
        now,
      ).mastery,
    ).toBe("mastered");
  });
  it("ages a session on its fourteenth Vancouver calendar day", () => {
    for (const [date, status] of [
      ["2026-11-02T20:00:00Z", "practicing"],
      ["2026-11-01T20:00:00Z", "needs_review"],
    ])
      expect(
        studyTopicEvidence(topic, [], [{ ...session, end_at: date }], now)
          .mastery,
      ).toBe(status);
  });
  it("flags upcoming exams by folder or explicit week range", () => {
    const exam = { course_id: "c", title: "Exam 3", due_date: "2026-11-24" };
    expect(studyTopicEvidence(topic, [exam], [], now).reason).toBe(
      "Exam 3 in 9 days",
    );
    expect(
      studyTopicEvidence(
        topic,
        [{ ...exam, title: "Midterm", notes: "Weeks 1–3" }],
        [],
        now,
      ).reason,
    ).toBe("Midterm in 9 days");
    for (const changed of [
      { title: "Exam 2" },
      { due_date: "2026-11-29" },
      { due_date: "2026-11-14" },
    ])
      expect(
        studyTopicEvidence(topic, [{ ...exam, ...changed }], [], now).reason,
      ).toBe("");
  });
});
