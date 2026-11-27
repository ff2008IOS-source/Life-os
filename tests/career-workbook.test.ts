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
