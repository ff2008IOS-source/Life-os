import { it, expect } from "vitest";
import { cellText } from "@/lib/sheet-cell";
it("shows spreadsheet date serials in date columns as dates", () => {
  expect(cellText("Week Of", 46391)).toBe("Jan 4, 2027");
  expect(cellText("Week Of", "46251")).toBe("Aug 17, 2026");
  expect(cellText("Deadline", 46363)).toBe("Dec 7, 2026");
});
it("leaves other values alone", () => {
  expect(cellText("Hours", 46391)).toBe("46391");
  expect(cellText("Week Of", "Nov 9")).toBe("Nov 9");
  expect(cellText("Week Of", null)).toBe("");
  expect(cellText("Due", 12)).toBe("12");
});
