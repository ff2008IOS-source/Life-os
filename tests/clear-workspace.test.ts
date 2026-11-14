import { describe, expect, it } from "vitest";
import { academicGrade, type GradeAssessment } from "@/lib/academic-grades";
import {
  assessmentResult,
  possibleAssessmentDuplicates,
  standingLabel,
  submissionLabel,
} from "@/lib/academic-display";
import {
  friendlyMaterialTitle,
  groupMaterials,
  materialAvailability,
} from "@/lib/material-library";
import { schedulingEligible } from "@/lib/scheduling-eligibility";
import { visibleArea } from "@/lib/visible-areas";
describe("consumer academic evidence", () => {
  const score = {
    id: "a",
    title: "Midterm Exam (Fall 2026)",
    earned_score: 87.5,
    maximum_score: 100,
    category_id: null,
    weight: 40,
    dropped: false,
    submission_state: "returned",
    verification_status: "verified",
  };
  it("shows a real result even with no confirmed grading formula", () => {
    const summary = academicGrade("unknown", [score]);
    expect(standingLabel(summary, false)).toEqual({
      title: "Results so far",
      value: "1 result",
    });
    expect(assessmentResult(score)).toBe("87.5 / 100 · 87.5%");
    expect(summary.overall_grade).toBeNull();
  });
  it("shows current standing on graded weight, without treating pending work as zero", () => {
    const pending: GradeAssessment = {
      ...score,
      id: "b",
      weight: 60,
      earned_score: null,
    };
    const summary = academicGrade("assessment_weights", [score, pending], [], {
      rulesVerified: true,
      inventoryComplete: true,
    });
    expect(standingLabel(summary, true)).toEqual({
      title: "Current standing",
      value: "87.5%",
    });
    expect(summary.graded_weight).toBe(40);
    expect(summary.overall_grade).toBeNull();
    expect(submissionLabel("unknown")).toBe("Not confirmed");
  });
  it("flags possible duplicate identities but never merges or changes scores", () => {
    const rows = [
      { id: "b", title: "Midterm exam", earned_score: null },
      score,
    ];
    const before = structuredClone(rows);
    expect(possibleAssessmentDuplicates(rows)).toEqual([["b", "a"]]);
    expect(rows).toEqual(before);
    expect(
      possibleAssessmentDuplicates([
        { id: "c", title: "Exam 1" },
        { id: "d", title: "Exam 2" },
      ]),
    ).toEqual([]);
  });
  it("keeps a missing score distinct from an earned zero or a submission", () => {
    expect(assessmentResult({ ...score, earned_score: 0 })).toBe(
      "0 / 100 · 0%",
    );
    expect(
      assessmentResult({
        ...score,
        earned_score: null,
        submission_state: "submitted",
      }),
    ).toBe("Awaiting grade");
    expect(
      assessmentResult({
        ...score,
        earned_score: null,
        submission_state: "unknown",
      }),
    ).toBe("Not recorded");
  });
});
describe("materials and project visibility", () => {
  it("does not call metadata or failed extraction ready", () => {
    expect(materialAvailability("File text not extracted yet", "")).toBe(
      "Open in Canvas",
    );
    expect(materialAvailability("unavailable · Canvas file HTTP 403", "")).toBe(
      "Unavailable",
    );
    expect(materialAvailability("processing", "")).toBe("Processing");
    expect(materialAvailability("ready", "Verified retrieved text")).toBe(
      "Ready",
    );
  });
  it("uses actual module membership ahead of filename guesses and preserves names", () => {
    const records = [
      {
        id: "1",
        type: "file",
        title: "Tutorial_2_questions.docx",
        module: "Week 2",
        course: "2",
      },
      {
        id: "2",
        type: "file",
        title: "Tutorial_2_answers.docx",
        module: "Week 2",
        course: "2",
      },
      { id: "3", type: "file", title: "Course_Syllabus.pdf", course: "2" },
    ];
    const result = groupMaterials(records, "");
    expect(result[0].title).toBe("Syllabus & course guide");
    expect(result[0].suggested).toBe(true);
    expect(result[1].title).toBe("Week 2");
    expect(result[1].suggested).toBe(false);
    expect(result[1].records).toHaveLength(2);
    expect(records[0].title).toBe("Tutorial_2_questions.docx");
    expect(friendlyMaterialTitle(records[0].title)).toBe(
      "Tutorial 2 questions",
    );
    expect(groupMaterials(records, "answers")[0].records).toHaveLength(1);
  });
  it("blocks removed projects even for individually scheduling-eligible tasks", () => {
    const task = { scheduling_mode: "eligible", status: "planned" };
    expect(
      schedulingEligible(
        task,
        {
          status: "active",
          automation_enabled: true,
          deleted_at: "2026-11-14",
        },
        false,
      ),
    ).toBe(false);
    expect(
      schedulingEligible(
        task,
        {
          status: "active",
          automation_enabled: true,
          archived_at: "2026-11-14",
        },
        false,
      ),
    ).toBe(false);
    expect(
      schedulingEligible(
        task,
        { status: "active", automation_enabled: true },
        false,
      ),
    ).toBe(true);
  });
  it("hides unused areas without deleting or changing their records", () => {
    const areas = [
      { slug: "academics" },
      { slug: "finances" },
      { slug: "wellbeing" },
    ];
    expect(areas.filter(visibleArea)).toEqual([{ slug: "academics" }]);
    expect(areas).toHaveLength(3);
  });
});
