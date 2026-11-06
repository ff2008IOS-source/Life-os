import { describe, it, expect } from "vitest";
import {
  groupCalendarEvents,
  layoutDay,
} from "@/lib/integrations/calendar-layout";
import { validCronSecret, runDailyWork } from "@/lib/integrations/daily-sync";
import type { CalendarEvent } from "@/lib/integrations/calendar-view";
const event: CalendarEvent = {
  id: "one",
  calendar_id: "calendar",
  provider_event_id: "one",
  title: "[TEST] Session",
  start_at: "2026-11-06T16:00:00Z",
  end_at: "2026-11-06T17:00:00Z",
  all_day_start: null,
  all_day_end: null,
  timezone: "America/Vancouver",
  busy_status: "busy",
  raw_metadata: {},
};
describe("compact calendar layout and daily worker limits", () => {
  it("groups only matching display entries and retains every original source", () => {
    const second = { ...event, id: "two", calendar_id: "other" };
    const different = { ...event, id: "three", end_at: "2026-11-06T17:30:00Z" };
    const groups = groupCalendarEvents([event, second, different]);
    expect(groups).toHaveLength(2);
    expect(groups[0].sources).toHaveLength(2);
    expect(groups[0].sources.map((x) => x.id)).toEqual(["one", "two"]);
    expect(groupCalendarEvents([event, second], false)).toHaveLength(2);
  });
  it("places overlapping events in columns and reclaims columns for later clusters", () => {
    const events = [
      event,
      {
        ...event,
        id: "two",
        title: "[TEST] Overlap",
        start_at: "2026-11-06T16:30:00Z",
        end_at: "2026-11-06T18:00:00Z",
      },
      {
        ...event,
        id: "three",
        title: "[TEST] Later",
        start_at: "2026-11-06T19:00:00Z",
        end_at: "2026-11-06T20:00:00Z",
      },
    ];
    const layout = layoutDay(groupCalendarEvents(events), "2026-11-06");
    expect(layout.map((x) => [x.start, x.end, x.column, x.columns])).toEqual([
      [540, 600, 0, 2],
      [570, 660, 1, 2],
      [720, 780, 0, 1],
    ]);
  });
  it("clips overnight events to the local day and leaves all-day events out of the time grid", () => {
    const overnight = {
      ...event,
      start_at: "2026-11-06T06:00:00Z",
      end_at: "2026-11-06T08:00:00Z",
    };
    const allDay = {
      ...event,
      id: "all",
      start_at: null,
      end_at: null,
      all_day_start: "2026-11-06",
      all_day_end: "2026-11-07",
    };
    const layout = layoutDay(
      groupCalendarEvents([overnight, allDay]),
      "2026-11-06",
    );
    expect(layout).toHaveLength(1);
    expect(layout[0].start).toBe(0);
    expect(layout[0].end).toBe(60);
  });
  it("requires a strong exact cron bearer credential and rejects missing configuration", () => {
    const secret = "a".repeat(40);
    expect(validCronSecret("Bearer " + secret, secret)).toBe(true);
    expect(validCronSecret("Bearer " + secret, undefined)).toBe(false);
    expect(validCronSecret(null, secret)).toBe(false);
    expect(validCronSecret("Bearer " + secret + "x", secret)).toBe(false);
    expect(validCronSecret("Bearer " + "b".repeat(40), secret)).toBe(false);
  });
  it("continues after a failed calendar and reports skipped and deferred work accurately", async () => {
    let now = 0;
    const rows = [0, 1, 2, 3].map((i) => ({
      id: String(i),
      user_id: "owner",
      connection_id: "connection",
    }));
    const result = await runDailyWork(
      rows,
      async (row) => {
        now += 100;
        if (row.id === "0") return "completed";
        if (row.id === "1") throw Error("synthetic");
        return "skipped";
      },
      () => now,
      250,
    );
    expect(result).toEqual({
      completed: 1,
      failed: 1,
      skipped: 1,
      deferred: 1,
    });
  });
});
