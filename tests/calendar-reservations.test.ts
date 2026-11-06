import { describe, it, expect } from "vitest";
import {
  reservationId,
  assertOwnedReservation,
} from "../src/lib/integrations/calendar-reservation";
describe("owned calendar reservations", () => {
  it("uses stable provider-valid event IDs so a repeated insertion can reconcile", () => {
    const a = reservationId("run", "task", "2026-11-06T18:00Z");
    expect(a).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(reservationId("run", "task", "2026-11-06T18:00Z")).toBe(a);
    expect(reservationId("other", "task", "2026-11-06T18:00Z")).not.toBe(a);
  });
  it("refuses a changed or unrelated provider event", () => {
    const e = {
      id: "x",
      etag: "v1",
      start: { dateTime: "2026-11-06T18:00Z" },
      end: { dateTime: "2026-11-06T19:00Z" },
      extendedProperties: {
        private: { lifeos_run: "run", lifeos_task: "task" },
      },
    };
    expect(() =>
      assertOwnedReservation(
        e,
        "run",
        "task",
        e.start.dateTime,
        e.end.dateTime,
      ),
    ).not.toThrow();
    expect(() =>
      assertOwnedReservation(
        { ...e, extendedProperties: {} },
        "run",
        "task",
        e.start.dateTime,
        e.end.dateTime,
      ),
    ).toThrow();
    expect(() =>
      assertOwnedReservation(
        e,
        "run",
        "task",
        "2026-11-06T18:30Z",
        e.end.dateTime,
      ),
    ).toThrow();
    expect(() =>
      assertOwnedReservation(
        { ...e, status: "cancelled" },
        "run",
        "task",
        e.start.dateTime,
        e.end.dateTime,
      ),
    ).toThrow();
  });
});
