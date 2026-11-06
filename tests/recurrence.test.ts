import { describe, it, expect } from "vitest";
import { occurrenceDates } from "@/lib/recurrence";
describe("bounded date-only recurrence", () => {
  it("generates stable daily occurrence keys without duplicates", () => {
    const dates = occurrenceDates(
      "FREQ=DAILY",
      "2026-11-06",
      null,
      "2026-11-06",
      7,
    );
    expect(dates).toHaveLength(8);
    expect(new Set(dates).size).toBe(8);
    expect(dates).toEqual(
      occurrenceDates("FREQ=DAILY", "2026-11-06", null, "2026-11-06", 7),
    );
  });
  it("respects weekly days, start/end and completed-history keys", () => {
    const dates = occurrenceDates(
      "FREQ=WEEKLY;BYDAY=MO,WE",
      "2026-11-01",
      "2026-11-12",
      "2026-11-06",
      20,
    );
    expect(dates).toEqual(["2026-11-09", "2026-11-11"]);
  });
  it("honors count and rejects unbounded sub-daily patterns", () => {
    expect(
      occurrenceDates(
        "FREQ=DAILY;COUNT=2",
        "2026-11-06",
        null,
        "2026-11-06",
        90,
      ),
    ).toHaveLength(2);
    expect(() =>
      occurrenceDates("FREQ=MINUTELY", "2026-11-06", null, "2026-11-06"),
    ).toThrow(/date-only/);
  });
});
