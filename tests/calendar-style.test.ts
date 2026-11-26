import { expect, it } from "vitest";
import { dayLoad, eventStyle, freeWindows } from "@/lib/calendar-style";

it("colours by category and drops the prefix only when the rest reads alone", () => {
  expect(eventStyle("ECON 113 · Lecture", "SFU ")).toEqual({
    tone: "class",
    label: "ECON 113 Lecture",
  });
  expect(eventStyle("Gym · A", "Personal")).toEqual({
    tone: "gym",
    label: "Gym A",
  });
  expect(eventStyle("MBB · Game vs APU", "SFU Men’s Basketball")).toEqual({
    tone: "mbb",
    label: "Game vs APU",
  });
  expect(
    eventStyle("SFU Basketball · Year-Round Program Camp", "Personal"),
  ).toEqual({ tone: "mbb", label: "Year-Round Program Camp" });
  expect(eventStyle("Study · ECON 115", "Study")).toEqual({
    tone: "study",
    label: "ECON 115",
  });
  expect(eventStyle("Career · NBA CBA", "Career")).toEqual({
    tone: "career",
    label: "NBA CBA",
  });
  expect(eventStyle("Dentist", "Personal")).toEqual({
    tone: "other",
    label: "Dentist",
  });
});

it("finds free stretches inside the window, from now on today", () => {
  const busy = [
    { start: 9 * 60, end: 10 * 60 },
    { start: 10 * 60 + 15, end: 12 * 60 },
    { start: 13 * 60, end: 14 * 60 },
  ];
  expect(freeWindows(busy, 9, 21)).toEqual([
    { start: 720, end: 780 },
    { start: 840, end: 1260 },
  ]);
  expect(freeWindows(busy, 9, 21, 15 * 60)).toEqual([
    { start: 900, end: 1260 },
  ]);
  expect(freeWindows([{ start: 0, end: 24 * 60 }], 9, 21)).toEqual([]);
});

it("summarises a day's load", () => {
  expect(dayLoad(5, 180, false)).toBe("5 · 3h free");
  expect(dayLoad(6, 30, false)).toBe("Busy");
  expect(dayLoad(0, 720, false)).toBe("12h free");
  expect(dayLoad(3, 0, true)).toBe("3 events");
});
