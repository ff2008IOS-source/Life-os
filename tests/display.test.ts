import { it, expect } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  dayBadge,
  dayLabel,
  dueLabel,
  markPercent,
  markTone,
} from "@/lib/display";
const z = "America/Vancouver";
const at = (s: string) => fromZonedTime(s, z);
// 11:30 PM Monday in Vancouver is already Tuesday in UTC.
const now = at("2026-11-23T23:30:00");
it("labels days relative to today in Vancouver time", () => {
  expect(dayLabel(at("2026-11-23T08:00:00"), now)).toBe("Today");
  expect(dayLabel(at("2026-11-24T16:20:00"), now)).toBe("Tomorrow");
  expect(dayLabel(at("2026-11-22T12:00:00"), now)).toBe("Yesterday");
  expect(dayLabel(at("2026-11-26T14:30:00"), now)).toBe("Thursday");
  expect(dayLabel(at("2026-12-07T12:00:00"), now)).toBe("Mon, Dec 7");
  expect(dayLabel("2026-11-24", now)).toBe("Tomorrow");
  expect(dayLabel(at("2027-01-04T12:00:00"), now)).toBe("Mon, Jan 4, 2027");
});
it("writes deadlines with times and short badges", () => {
  expect(
    dueLabel({ due_at: at("2026-11-24T16:20:00").toISOString() }, now),
  ).toBe("Tomorrow, 4:20 PM");
  expect(dueLabel({ due_date: "2026-11-23" }, now)).toBe("Today");
  expect(dueLabel({}, now)).toBe("No due date");
  expect(dayBadge(at("2026-11-24T16:20:00"), now)).toBe("TMRW");
  expect(dayBadge(at("2026-11-25T16:20:00"), now)).toBe("WED");
  expect(dayBadge(at("2026-12-07T16:20:00"), now)).toBe("DEC 7");
});
it("colours marks at 83% and 70%", () => {
  expect(markTone(83)).toBe("good");
  expect(markTone(82.9)).toBe("ok");
  expect(markTone(70)).toBe("ok");
  expect(markTone(69.9)).toBe("low");
  expect(markPercent(0.835, 1)).toBeCloseTo(83.5);
  expect(markPercent(14.5, 15)).toBeCloseTo(96.67, 1);
  expect(markPercent(87.5, null, "percent")).toBe(87.5);
  expect(markPercent(null, 10)).toBeNull();
  expect(markPercent(5, 0)).toBeNull();
});
