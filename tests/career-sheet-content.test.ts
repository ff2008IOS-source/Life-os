import { it, expect } from "vitest";
import {
  buildWeeklyReview,
  sheetSerial,
} from "../src/lib/integrations/career-sheet-content";

it("converts dates to the sheet serials already stored in Weekly Review", () => {
  expect(sheetSerial("2026-11-16")).toBe(46342);
  expect(sheetSerial("2026-11-30")).toBe(46356);
});

it("fills only fields with Life OS evidence and never blanks others", () => {
  const v = buildWeeklyReview({
    weekStart: "2026-11-30",
    gradedThisWeek: [],
    completedTaskCount: 0,
    overdue: [],
    dueNextWeek: [],
    topTasksNextWeek: [],
  });
  expect(v).toEqual({ week_of: 46356 });
  const w = buildWeeklyReview({
    weekStart: "2026-11-30",
    gradedThisWeek: [
      {
        course: "ECON 113",
        title: "Midterm",
        earned: 87.5,
        max: 100,
        due_date: "2026-12-01",
        graded: true,
      },
    ],
    completedTaskCount: 3,
    overdue: [{ title: "Read ch. 4", due_date: "2026-11-25" }],
    dueNextWeek: [],
    topTasksNextWeek: [
      { title: "A", due_date: null },
      { title: "B", due_date: null },
      { title: "C", due_date: null },
      { title: "D", due_date: null },
    ],
  });
  expect(w.academic_win).toContain("ECON 113 Midterm: 87.5/100 (87.5%)");
  expect(w.academic_risk).toContain("Overdue: Read ch. 4");
  expect(w.top_three).toBe("1. A 2. B 3. C");
  expect(w).not.toHaveProperty("notes");
  expect(w).not.toHaveProperty("networking");
});
