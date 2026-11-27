import { describe, expect, it } from "vitest";
import {
  readWorkbook,
  sheetDate,
  statusOf,
  type Workbook,
} from "@/lib/career/workbook";
import { hashOf, legacyKey } from "@/lib/career/import-keys";

/** Synthetic data in the real workbook's layout (no personal records). */
export const workbook: Workbook = {
  tabs: [
    {
      id: 398872817,
      title: "Network & Applications",
      values: [
        ["Networking + Internship / Co-op Pipeline"],
        ["Contacts on top, applications below."],
        [],
        ["CONTACTS"],
        [
          "Name",
          "Organization",
          "Role",
          "How We Met",
          "Last Contact",
          "Next Follow-Up",
          "Follow-up by",
        ],
        [
          "[TEST] Avery Coach",
          "Test Club",
          "Assistant Coach",
          "Team manager",
          "",
          "Follow up when available; Nov 3 target passed",
        ],
        [
          "[TEST] Blake Trainer",
          "Test Training",
          "Trainer",
          "Camp",
          "Wed Oct 28",
        ],
        [],
        [],
        [],
        ["APPLICATIONS"],
        ["Organization / Role", "Type", "Deadline", "Status", "Stage"],
        [
          "[TEST] Bandits — video ops (target employer)",
          "Sports",
          "",
          "Research",
          "Target employer",
        ],
        [
          "[TEST] Bank — summer analyst",
          "Finance",
          "Fri Dec 4",
          "Drafting",
          "Application",
        ],
      ],
    },
    {
      id: 1591864853,
      title: "Skills & Portfolio",
      values: [
        ["Skills + Portfolio"],
        [],
        [],
        ["SKILLS"],
        [
          "Skill",
          "Current Level",
          "Year Target",
          "Practice Rhythm",
          "Status",
          "Evidence",
        ],
        [
          "Excel",
          "Beginner",
          "Advanced",
          "Weekly",
          "In Progress",
          "Basic functions practised",
        ],
        ["SQL", "Not Started", "Strong", "Year 2", "Not Started"],
        [],
        [],
        ["PORTFOLIO"],
        ["Project", "Target Date", "Status", "Next step", "Area"],
        [
          "Milestone 2 — Synthetic shooting report demo",
          "Nov 10, 2026",
          "Not Completed — self-reported Nov 15",
          "Build sample",
          "Portfolio",
        ],
        ["Hoops dashboard", "", "In Progress", "", "Basketball"],
      ],
    },
    {
      id: 684098405,
      title: "Weekly Review",
      values: [
        ["20-Minute Weekly Career Review"],
        ["Sunday: add a Win…"],
        ["Jump to this week →"],
        [
          "Week Of",
          "Win",
          "Risk",
          "Pick 1",
          "Pick 2",
          "Pick 3",
          "Basketball Progress",
          "Skill Progress",
          "Networking",
          "Top 3 Next Week",
          "Calendar Blocks Added?",
          "Overall Status",
          "Notes",
        ],
        [
          "Aug 17",
          "First win",
          "No risk",
          "",
          "",
          "",
          "Meeting",
          "",
          "",
          "Plan",
          "Yes",
          "On Track",
          "Notes A",
        ],
        [
          "Nov 23",
          "Win",
          "Risk",
          "PHIL 100 — Confirm paper",
          "ECON 115 — Prepare for Exam 3",
          "",
          "",
          "",
          "",
          "Verify deadlines",
          "",
          "",
          "Review notes",
        ],
        ["Nov 30"],
        ["Jan 4"],
      ],
    },
    {
      id: 14198660,
      title: "Semester Plan",
      values: [
        ["Semester Execution Plan"],
        [],
        [],
        [
          "Semester",
          "Area",
          "Goal",
          "Metric",
          "Priority",
          "Status",
          "Next Action",
          "Deadline",
          "Evidence",
          "Notes",
        ],
        [
          "Fall 2026",
          "Academics",
          "Earn strong GPA",
          "3.3+",
          "Critical",
          "In Progress",
          "Protect exams",
          "2026-12-20",
          "",
          "No invented average.",
        ],
      ],
    },
    {
      id: 1907485386,
      title: "Calendar Playbook",
      values: [
        ["How Google Calendar Supports the Career Plan"],
        [],
        [],
        [
          "PUT ON CALENDAR",
          "Cadence",
          "Typical Length",
          "Purpose",
          "",
          "DO NOT PUT ON CALENDAR",
          "Why",
          "Put It Here Instead",
        ],
        [
          "Classes",
          "Fixed",
          "As scheduled",
          "Protect academics",
          "",
          "Get into Beedie",
          "Outcome, not an appointment",
          "Semester Plan",
        ],
        ["Weekly career review", "Weekly", "20 min", "Plan next week"],
        [],
        [],
        [
          "Dashboard decides WHAT matters → Weekly Review decides NEXT actions → Calendar reserves WHEN.",
        ],
      ],
    },
  ],
};

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
