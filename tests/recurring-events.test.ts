import { it, expect } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { recurringEventIds } from "@/lib/recurring-events";
const at = (s: string) => fromZonedTime(s, "America/Vancouver").toISOString();
it("treats Google series instances as repeating", () => {
  expect(
    recurringEventIds([
      {
        id: "a",
        title: "ECON 113 · Lecture",
        start_at: at("2026-11-23T14:30:00"),
        raw_metadata: { recurring_event_id: "s1" },
      },
      {
        id: "b",
        title: "Dentist",
        start_at: at("2026-11-23T14:30:00"),
        raw_metadata: {},
      },
    ]),
  ).toEqual(new Set(["a"]));
});
it("treats an event that recurs a week apart at the same local time as repeating, across a DST change", () => {
  const ids = recurringEventIds([
    {
      id: "w1",
      title: "Career · Excel Fundamentals",
      start_at: at("2026-10-26T14:00:00"),
    },
    // Clocks fall back on Nov 1; the local time stays 2:00 PM.
    {
      id: "w2",
      title: "career ·  excel fundamentals",
      start_at: at("2026-11-02T14:00:00"),
    },
    {
      id: "one",
      title: "Career · Excel Fundamentals",
      start_at: at("2026-11-04T14:00:00"),
    },
    {
      id: "moved",
      title: "Shooting Chart Renewal",
      start_at: at("2026-11-23T07:00:00"),
    },
    {
      id: "moved2",
      title: "Shooting Chart Renewal",
      start_at: at("2026-11-30T08:00:00"),
    },
  ]);
  expect([...ids].sort()).toEqual(["w1", "w2"]);
});
