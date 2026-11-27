import { describe, expect, it } from "vitest";
import { readWorkbook, sheetDate, statusOf } from "@/lib/career/workbook";
import { workbook } from "./fixtures/career-workbook";
import { hashOf, legacyKey } from "@/lib/career/import-keys";

describe("career workbook import", () => {
  const { records, skipped, missing } = readWorkbook(workbook);
  const by = (k: string) => records.find((r) => r.key === k);

  it("reads dates the workbook writes, and leaves notes as notes", () => {
    expect(sheetDate("Fri Dec 4")).toBe("2026-12-04");
    expect(sheetDate("Nov 3, 2026")).toBe("2026-11-03");
    expect(sheetDate("2026-12-20")).toBe("2026-12-20");
    expect(sheetDate("Jan 4")).toBe("2027-01-04");
    expect(
      sheetDate("Follow up when available; Nov 3 target passed"),
    ).toBeNull();
    expect(statusOf("Not Completed — self-reported Nov 15")).toBe(
      "Not Started",
    );
  });

  it("keeps target employers apart from real applications", () => {
    expect(
      by("wb:employer:test-bandits-video-ops-target-employer"),
    ).toMatchObject({ kind: "application_target", due_date: null });
    expect(by("wb:application:test-bank-summer-analyst")).toMatchObject({
      kind: "application",
      due_date: "2026-12-04",
    });
  });

  it("contacts keep text follow-ups as notes and real dates as dates", () => {
    expect(by("wb:contact:test-avery-coach")).toMatchObject({
      table: "contacts",
      next_follow_up_date: null,
      relationship_notes:
        "Next follow-up: Follow up when available; Nov 3 target passed",
    });
    expect(by("wb:contact:test-blake-trainer")).toMatchObject({
      last_contact_at: "2026-10-28",
    });
  });

  it("milestones keep one identity even if their wording changes", () => {
    expect(by("wb:portfolio:milestone-2")).toMatchObject({
      kind: "portfolio_project",
      due_date: "2026-11-10",
      status: "Not Started",
    });
    expect(
      legacyKey(
        '["x",1591864853,"portfolio_project","Milestone 2 — older wording"]',
        "portfolio_project",
      ),
    ).toBe("wb:portfolio:milestone-2");
    expect(
      by("wb:skill:excel")?.table === "career_entries" && by("wb:skill:excel"),
    ).toMatchObject({
      details: {
        evidence: [{ text: "Basic functions practised", source: "workbook" }],
      },
    });
  });

  it("imports each reviewed week with its picks and skips empty weeks", () => {
    expect(by("wb:review:2026-11-23")).toMatchObject({
      table: "reviews",
      period_end: "2026-11-29",
      details: {
        picks: ["PHIL 100 — Confirm paper", "ECON 115 — Prepare for Exam 3"],
      },
    });
    expect(skipped.map((s) => s.row)).toEqual(["Nov 30", "Jan 4"]);
  });

  it("preserves Calendar Playbook guidance whole", () => {
    expect(by("wb:reference:calendar-playbook")).toMatchObject({
      kind: "reference",
      details: {
        put_on_calendar: [
          { what: "Classes", cadence: "Fixed" },
          { what: "Weekly career review", cadence: "Weekly" },
        ],
        do_not_put: [{ what: "Get into Beedie", instead: "Semester Plan" }],
        principle: expect.stringContaining("Dashboard decides WHAT"),
      },
    });
  });

  it("reports missing tabs and hashes ignore bookkeeping keys", () => {
    expect(missing).toContain("Dashboard");
    expect(hashOf({ a: 1, b: { c: 2, _workbook: 9 } })).toBe(
      hashOf({ b: { c: 2 }, a: 1 }),
    );
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});

describe("sheet ranges", () => {
  it("names columns past Z the way Sheets does", async () => {
    const { columnLetter } = await import("@/lib/integrations/sheet-columns");
    expect([1, 26, 27, 29, 52].map(columnLetter)).toEqual([
      "A",
      "Z",
      "AA",
      "AC",
      "AZ",
    ]);
  });
});

describe("dashboard tab", () => {
  // Same layout as the real Dashboard: tables separated by one blank row.
  const dash = {
    id: 1,
    title: "Dashboard",
    values: [
      [
        "North Star",
        "Target",
        "",
        "KPI",
        "Target",
        "Current",
        "Status",
        "Notes",
      ],
      [
        "[TEST] Direction",
        "Somewhere",
        "",
        "GPA",
        "3.3+",
        "",
        "In Progress",
        "",
      ],
      [],
      ["CURRENT PRIORITY: FALL 2026"],
      ["Priority", "Objective", "Measure", "Status", "Next Action", "Deadline"],
      ["Critical", "[TEST] One", "m", "In Progress", "a", "2026-12-20"],
      ["High", "[TEST] Two", "m", "Complete", "a", "2026-09-15"],
      ["Medium", "[TEST] Three", "m", "In Progress", "a", "2026-12-20"],
      [],
      ["Dashboard Metrics", "Value", "", "Rule", "Use"],
      ["Current priorities", "3", "", "Sheet", "x"],
      ["Complete", "1"],
      ["On Track / In Progress", "2"],
      ["At Risk", "0"],
      ["Completion %", "33%"],
      [],
      ["NOVEMBER 2026 CAREER MILESTONES — SELF-SET TARGETS"],
      ["#", "Objective", "Evidence / current state", "Status"],
      ["1", "[TEST] First", "e", "In Progress"],
      [],
      ["TRACKING RULE", "A plan is not a result."],
    ],
  };
  const { records } = readWorkbook({ tabs: [...workbook.tabs, dash] });
  const ref = (k: string) =>
    records.find((r) => r.key === "wb:reference:" + k) as {
      details: Record<string, unknown>;
    };
  it("stops each table where it ends", () => {
    expect(ref("north-star").details.north_star).toHaveLength(1);
    expect(ref("fall-2026-priorities").details.rows).toHaveLength(3);
    expect(ref("november-2026-milestones").details.rows).toHaveLength(1);
  });
  it("keeps the workbook's own metrics to verify against", () => {
    expect(ref("fall-2026-priorities").details.metrics).toMatchObject({
      "Current priorities": "3",
      "Completion %": "33%",
    });
  });
});

describe("course notes", () => {
  it("keeps the next step on the next assessment", async () => {
    const { currentAction } = await import("@/lib/career/workbook");
    expect(
      currentAction("Prepare for Exam 2 Friday Nov 13", "Exam 3", "Fri Dec 4"),
    ).toBe("Prepare for Exam 3 (Fri Dec 4)");
    expect(currentAction("Review Exam 3 practice set", "Exam 3", "")).toBe(
      "Review Exam 3 practice set",
    );
  });
  it("drops grade percentages, which come from Canvas and the syllabus", async () => {
    const { withoutPercentages } = await import("@/lib/career/workbook");
    expect(
      withoutPercentages(
        "Exam 1 82.4%; Canvas shows 76.48%. Office hours Tuesdays.",
      ),
    ).toBe("Office hours Tuesdays.");
  });
});
