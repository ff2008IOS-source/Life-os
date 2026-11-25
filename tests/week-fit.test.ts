import { expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { weekFit } from "@/lib/week-fit";

const at = (local: string) =>
  fromZonedTime(local, "America/Vancouver").toISOString();

const policy = { start_hour: 9, end_hour: 21, max_daily_minutes: 240 };
const now = new Date(at("2026-11-23T09:00:00")); // Mon 9:00 AM Vancouver
const task = (title: string, due: string, est: number | null, v = {}) => ({
  title,
  status: "planned",
  due_at: null,
  due_date: due,
  estimated_minutes: est,
  ...v,
});

it("caps each day at the daily limit and subtracts busy time", () => {
  const r = weekFit({
    now,
    policy,
    events: [
      // Monday 9 AM–5 PM busy leaves 4 h (9 PM end): exactly the cap.
      {
        start_at: at("2026-11-23T09:00:00"),
        end_at: at("2026-11-23T17:00:00"),
        all_day_start: null,
      },
      // A free event doesn't count as busy.
      {
        start_at: at("2026-11-24T09:00:00"),
        end_at: at("2026-11-24T21:00:00"),
        all_day_start: null,
        busy_status: "free",
      },
    ],
    tasks: [],
  });
  expect(r.perDay[0].free).toBe(240);
  expect(r.perDay[1].free).toBe(240);
  expect(r.freeMinutes).toBe(7 * 240);
});

it("compares estimated work due this week with free time", () => {
  const r = weekFit({
    now,
    policy: { ...policy, max_daily_minutes: 60 },
    events: [],
    tasks: [
      task("Essay", "2026-11-26", 300),
      task("Old", "2026-11-20", 120, { actual_minutes: 30 }),
      task("No estimate", "2026-11-27", null),
      task("Next week", "2026-12-05", 600),
      task("Done", "2026-11-25", 90, { status: "completed" }),
    ],
  });
  expect(r.needMinutes).toBe(390);
  expect(r.freeMinutes).toBe(420);
  expect(r.fits).toBe(true);
  expect(r.unestimated).toEqual(["No estimate"]);
  const tight = weekFit({
    now,
    policy: { ...policy, max_daily_minutes: 30 },
    events: [],
    tasks: [task("Essay", "2026-11-26", 300)],
  });
  expect(tight.fits).toBe(false);
  expect(tight.shortMinutes).toBe(90);
});
