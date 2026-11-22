import { fromZonedTime } from "date-fns-tz";
import { it, expect } from "vitest";
import {
  todayPlan,
  remainingEffort,
  weekOf,
  shiftDay,
  unionIntervals,
} from "@/lib/today-plan";
import { preparationDeadline, isOverdue } from "@/lib/dates";
import { DEFAULT_POLICY } from "@/lib/scheduler";
import { taskInput, type Task } from "@/lib/schemas";
const now = new Date("2026-11-08T18:00:00Z");
const task = (id: string, values = {}) =>
  ({
    ...taskInput.parse({ title: id, ...values }),
    id,
    user_id: "owner",
    version: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
    source_type: "manual",
    source_key: null,
    recurrence_rule_id: null,
  }) as Task;
const block = (
  id: string,
  task_id: string,
  start_at = "2026-11-08T20:00:00Z",
  end_at = "2026-11-08T20:30:00Z",
) => ({ id, task_id, start_at, end_at, status: "planned" });
const plan = (tasks: Task[], extra = {}) =>
  todayPlan({
    workspace: { tasks, dependencies: [] },
    day: "2026-11-08",
    zone: "America/Vancouver",
    now,
    policy: DEFAULT_POLICY,
    blocks: [],
    events: [],
    reliable: true,
    ...extra,
  });
it("counts allocated blocks rather than due dates or entire remaining task estimates", () => {
  const t = task("assignment", {
      estimated_minutes: 90,
      actual_minutes: 20,
      due_date: "2026-11-08",
    }),
    inbox = task("inbox");
  const result = plan([t, inbox], {
    blocks: [
      block("a", "assignment"),
      block("b", "assignment", "2026-11-08T22:00:00Z", "2026-11-08T22:30:00Z"),
    ],
  });
  expect(result.plannedMinutes).toBe(60);
  expect(remainingEffort(t)).toBe(70);
  expect(result.planned.map((t) => t.id)).toEqual(["assignment"]);
  expect(result.due).toEqual([]);
  expect(result.inbox.map((t) => t.id)).toEqual(["inbox"]);
});
it("keeps blocked work out of the usable list and explains its dependency", () => {
  const a = task("blocked", { due_date: "2026-11-07", estimated_minutes: 30 }),
    b = task("ready", { due_date: "2026-11-08", estimated_minutes: 25 }),
    dependency = task("prerequisite");
  const result = plan([a, b, dependency], {
    workspace: {
      tasks: [a, b, dependency],
      dependencies: [
        { predecessor_task_id: "prerequisite", successor_task_id: "blocked" },
      ],
    },
  });
  expect(result.waiting.map((t) => t.id)).toEqual(["blocked"]);
  expect(result.overdue).toEqual([]);
  expect(result.blocking(a)[0].id).toBe("prerequisite");
  expect(result.recommendation?.id).toBe("ready");
});
it("unions overlapping commitments, respects cap and shows only a real uninterrupted gap", () => {
  const event = (id: string, start_at: string, end_at: string) => ({
    id,
    calendar_id: "c",
    title: id,
    start_at,
    end_at,
    all_day_start: null,
    timezone: "America/Vancouver",
    busy_status: "busy",
  });
  const result = plan([], {
    events: [
      event("class", "2026-11-08T19:00:00Z", "2026-11-08T20:30:00Z"),
      event("meeting", "2026-11-08T20:00:00Z", "2026-11-08T21:00:00Z"),
    ],
  });
  expect(result.gap?.minutes).toBe(60);
  expect(result.available).toBe(240);
  expect(
    unionIntervals([
      { start: 1, end: 4 },
      { start: 3, end: 7 },
    ]),
  ).toEqual([{ start: 1, end: 7 }]);
});
it("does not silently turn unknown or used-up effort into feasible zero-minute work", () => {
  const unknown = task("unknown"),
    spent = task("spent", { estimated_minutes: 30, actual_minutes: 45 });
  const result = plan([unknown, spent], { blocks: [block("a", "unknown")] });
  expect(result.unknown).toBe(1);
  expect(remainingEffort(unknown)).toBeNull();
  expect(remainingEffort(spent)).toBe(0);
  expect(result.recommendation).toBeNull();
  expect(plan([unknown], { reliable: false }).available).toBeNull();
});
it("uses selected Monday–Sunday weeks, Vancouver midnight, month and DST boundaries", () => {
  expect(weekOf("2026-11-08")).toEqual({
    weekStart: "2026-11-02",
    weekEnd: "2026-11-08",
  });
  expect(weekOf("2026-11-09").weekStart).toBe("2026-11-09");
  expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
  const due = task("date-only", { due_date: "2026-11-01" }),
    timed = task("timed", {
      due_at: fromZonedTime(
        "2026-11-01T23:30:00",
        "America/Vancouver",
      ).toISOString(),
    });
  const result = plan([due, timed], {
    day: "2026-11-01",
    now: fromZonedTime("2026-11-01T23:00:00", "America/Vancouver"),
  });
  expect(result.live).toBe(true);
  expect(result.due.map((t) => t.id)).toEqual(["date-only", "timed"]);
  expect(plan([due], { day: "2026-10-31" }).recommendation).toBeNull();
});
it("a short gap can start a segment without pretending the whole assignment fits", () => {
  const big = task("big", { estimated_minutes: 90 });
  const result = plan([big], {
    policy: { ...DEFAULT_POLICY, max_daily_minutes: 30 },
  });
  expect(result.gap?.minutes).toBe(30);
  expect(result.recommendation?.id).toBe("big");
  expect(remainingEffort(big)).toBe(90);
});
it("can start an already allocated block without treating that booking as free time", () => {
  const t = task("allocated", { estimated_minutes: 90, actual_minutes: 20 });
  const result = plan([t], {
    blocks: [
      block("now", "allocated", "2026-11-08T17:45:00Z", "2026-11-08T18:30:00Z"),
    ],
  });
  expect(result.recommendation?.id).toBe("allocated");
  expect(result.allocatedNow).toBe(true);
  expect(result.focusMinutes).toBe(30);
  expect(result.plannedMinutes).toBe(45);
});
it("a missing dependency record is still blocking and never a feasible recommendation", () => {
  const t = task("blocked", { estimated_minutes: 30 });
  const result = plan([t], {
    workspace: {
      tasks: [t],
      dependencies: [
        { predecessor_task_id: "missing", successor_task_id: "blocked" },
      ],
    },
  });
  expect(result.waiting.map((t) => t.id)).toEqual(["blocked"]);
  expect(result.recommendation).toBeNull();
  expect(result.blocking(t)).toEqual([]);
});

it("uses Vancouver local dates across historical 23-hour and 25-hour days", () => {
  const local = (day: string) =>
    fromZonedTime(day + "T00:00:00", "America/Vancouver").getTime();
  expect((local("2025-03-10") - local("2025-03-09")) / 3600000).toBe(23);
  expect((local("2025-11-03") - local("2025-11-02")) / 3600000).toBe(25);
  const due = task("fall-deadline", { due_date: "2025-11-02" });
  expect(
    plan([due], {
      day: "2025-11-02",
      now: fromZonedTime("2025-11-02T23:55:00", "America/Vancouver"),
    }).due.map((t) => t.id),
  ).toEqual([due.id]);
});

it("keeps the same breaks around allocated work as the scheduler", () => {
  const result = plan([task("booked")], {
    blocks: [
      block("b", "booked", "2026-11-08T19:00:00Z", "2026-11-08T19:30:00Z"),
    ],
  });
  expect(result.gap?.minutes).toBe(50);
  expect(result.plannedMinutes).toBe(30);
});

it("completed focus records consume real effort without creating a zero-minute planned task", () => {
  const result = plan(
    [task("still-open", { estimated_minutes: 60, actual_minutes: 5 })],
    {
      blocks: [
        {
          ...block(
            "done",
            "still-open",
            "2026-11-08T17:00:00Z",
            "2026-11-08T17:00:01Z",
          ),
          status: "completed",
          actual_minutes: 5,
        },
      ],
    },
  );
  expect(result.planned).toEqual([]);
  expect(result.plannedMinutes).toBe(0);
  expect(result.completedMinutes).toBe(5);
  expect(result.available).toBe(235);
});

it("official preparation deadlines constrain a personal target without deleting earlier targets", () => {
  const personal = { due_at: null, due_date: "2026-11-20" };
  expect(
    preparationDeadline(personal, { due_at: null, due_date: "2026-11-19" })
      .due_date,
  ).toBe("2026-11-19");
  expect(
    preparationDeadline(personal, { due_at: null, due_date: "2026-11-21" }),
  ).toEqual(personal);
  expect(
    preparationDeadline(personal, { due_at: null, due_date: null }),
  ).toEqual(personal);
});

it("uses a timestamped deadline before a coexisting legacy date in every overdue label", () => {
  expect(
    isOverdue(
      {
        due_at: "2026-11-08T17:00:00Z",
        due_date: "2026-11-20",
        status: "planned",
        deleted_at: null,
      },
      now,
    ),
  ).toBe(true);
});
