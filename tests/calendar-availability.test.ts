import { describe, it, expect } from "vitest";
import {
  calendarBusy,
  type AvailabilityEvent,
} from "../src/lib/calendar-availability";
const event: AvailabilityEvent = {
  start_at: null,
  end_at: null,
  all_day_start: "2025-11-02",
  all_day_end: "2025-11-03",
  timezone: "America/Vancouver",
  busy_status: "busy",
  event_status: "confirmed",
};
describe("live calendar availability", () => {
  it("respects exclusive all-day ends across the Vancouver clock change", () => {
    expect(calendarBusy([event])).toEqual([
      {
        start_at: "2025-11-02T07:00:00.000Z",
        end_at: "2025-11-03T08:00:00.000Z",
      },
    ]);
  });
  it("excludes transparent and cancelled events", () => {
    expect(
      calendarBusy([
        { ...event, busy_status: "free" },
        { ...event, event_status: "cancelled" },
      ]),
    ).toEqual([]);
  });
  it("fails closed on malformed busy availability", () => {
    expect(() => calendarBusy([{ ...event, all_day_end: null }])).toThrow();
  });
});
