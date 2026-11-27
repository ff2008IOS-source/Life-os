import { describe, expect, it } from "vitest";
import { areaOf, weekSkyline } from "@/lib/areas";

describe("areas", () => {
  it("names the area of work and events", () => {
    expect(areaOf("PHIL 100 — Confirm second paper")).toBe("school");
    expect(areaOf("Exam 3", "ECON 115")).toBe("school");
    expect(areaOf("Basketball — Ask Kaden about report")).toBe("ball");
    expect(areaOf("MBB · Game vs BHSU")).toBe("ball");
    expect(areaOf("Follow up with Kaden Hruska")).toBe("career");
    expect(areaOf("Apply: Credit union analyst")).toBe("career");
    expect(areaOf("Study · GEOG 104 Weekly Catch-Up")).toBe("study");
    expect(areaOf("Gym · B")).toBe("gym");
    expect(areaOf("Dentist")).toBe("other");
  });
  it("builds one bar per day with busy minutes and deadline pins", () => {
    const z = "America/Vancouver";
    const days = weekSkyline(
      [
        { start_at: "2026-11-23T17:00:00Z", end_at: "2026-11-23T19:00:00Z" },
        { start_at: "2026-11-23T20:00:00Z", end_at: "2026-11-23T20:30:00Z" },
        {
          start_at: "2026-11-24T17:00:00Z",
          end_at: "2026-11-24T18:00:00Z",
          busy_status: "free",
        },
      ],
      [
        {
          title: "Exam 3",
          label: "ECON 115",
          due: Date.parse("2026-11-27T20:00:00Z"),
        },
      ],
      "2026-11-23",
      z,
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({
      date: "2026-11-23",
      busyMinutes: 150,
      events: 2,
    });
    expect(days[1].events).toBe(0);
    expect(days[4].pins).toEqual(["ECON 115"]);
  });
});
