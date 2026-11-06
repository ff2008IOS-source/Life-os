import { describe, it, expect } from "vitest";
import {
  schedule,
  DEFAULT_POLICY,
  type ScheduleInput,
  type ScheduleTask,
} from "@/lib/scheduler";
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@/lib/dates";
const task = (
  id: string,
  extras: Partial<ScheduleTask> = {},
): ScheduleTask => ({
  id,
  title: `[TEST] ${id}`,
  status: "inbox",
  area: "academics",
  eligible: true,
  estimated_minutes: 120,
  actual_minutes: null,
  priority: 2,
  due_at: null,
  due_date: null,
  ...extras,
});
const input = (extras: Partial<ScheduleInput> = {}): ScheduleInput => ({
  now: "2026-11-06T16:00:00Z",
  tasks: [task("a")],
  busy: [],
  existing: [],
  dependencies: [],
  policy: { ...DEFAULT_POLICY },
  ...extras,
});
describe("deterministic scheduling constraints", () => {
  it("is deterministic and stays within local work windows and session limits", () => {
    const i = input();
    const result = schedule(i);
    expect(result).toEqual(schedule(i));
    expect(result.blocks.reduce((n, b) => n + b.minutes, 0)).toBe(120);
    for (const b of result.blocks) {
      expect(b.minutes).toBeGreaterThanOrEqual(25);
      expect(b.minutes).toBeLessThanOrEqual(90);
      expect(
        Number(formatInTimeZone(b.start_at, TIMEZONE, "H")),
      ).toBeGreaterThanOrEqual(9);
      expect(
        Number(formatInTimeZone(b.end_at, TIMEZONE, "H")),
      ).toBeLessThanOrEqual(21);
    }
  });
  it("never overlaps busy commitments and enforces breaks", () => {
    const busy = [
      { start_at: "2026-11-06T17:00:00Z", end_at: "2026-11-06T20:00:00Z" },
    ];
    const result = schedule(input({ busy }));
    for (const b of result.blocks) {
      for (const busyEvent of busy)
        expect(
          new Date(b.end_at) <= new Date(busyEvent.start_at) ||
            new Date(b.start_at) >= new Date(busyEvent.end_at),
        ).toBe(true);
    }
    for (let i = 1; i < result.blocks.length; i++)
      expect(
        (+new Date(result.blocks[i].start_at) -
          +new Date(result.blocks[i - 1].end_at)) /
          60000,
      ).toBeGreaterThanOrEqual(10);
    expect(busy[0].start_at).toBe("2026-11-06T17:00:00Z");
  });
  it("enforces 240-minute cap including existing blocks", () => {
    const existing = [
      {
        task_id: "other",
        status: "planned" as const,
        start_at: "2026-11-06T17:00:00Z",
        end_at: "2026-11-06T18:00:00Z",
      },
    ];
    const result = schedule(
      input({ tasks: [task("a", { estimated_minutes: 500 })], existing }),
    );
    const daily = new Map<string, number>();
    for (const b of [...result.blocks, ...existing]) {
      const day = formatInTimeZone(b.start_at, TIMEZONE, "yyyy-MM-dd");
      daily.set(
        day,
        (daily.get(day) ?? 0) +
          (+new Date(b.end_at) - +new Date(b.start_at)) / 60000,
      );
    }
    expect(Math.max(...daily.values())).toBeLessThanOrEqual(240);
    expect(existing[0].start_at).toBe("2026-11-06T17:00:00Z");
  });
  it("keeps the freeze window and deadline unchanged", () => {
    const original = task("a", { due_date: "2026-11-06" });
    const now = "2026-11-06T18:30:00Z";
    const result = schedule(input({ now, tasks: [original] }));
    expect(
      +new Date(result.blocks[0].start_at) - +new Date(now),
    ).toBeGreaterThanOrEqual(60 * 60000);
    expect(original.due_date).toBe("2026-11-06");
  });
  it("does not authorize excluded tasks, areas, or missing estimates", () => {
    const result = schedule(
      input({
        tasks: [
          task("a", { eligible: false }),
          task("b", { area: "finances" }),
          task("c", { estimated_minutes: null }),
        ],
      }),
    );
    expect(result.blocks).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
  });
  it("schedules prerequisites before dependent tasks", () => {
    const result = schedule(
      input({
        tasks: [task("b"), task("a")],
        dependencies: [{ predecessor_task_id: "a", successor_task_id: "b" }],
      }),
    );
    const a = result.blocks.filter((b) => b.task_id === "a");
    const b = result.blocks.filter((b) => b.task_id === "b");
    expect(+new Date(b[0].start_at)).toBeGreaterThanOrEqual(
      +new Date(a.at(-1)!.end_at),
    );
  });
  it("reports circular, unavailable and infeasible work explicitly", () => {
    const cycle = schedule(
      input({
        tasks: [task("a"), task("b")],
        dependencies: [
          { predecessor_task_id: "a", successor_task_id: "b" },
          { predecessor_task_id: "b", successor_task_id: "a" },
        ],
      }),
    );
    expect(cycle.blocks).toHaveLength(0);
    expect(cycle.warnings).toHaveLength(2);
    const impossible = schedule(
      input({ tasks: [task("a", { due_at: "2026-11-06T15:00:00Z" })] }),
    );
    expect(impossible.blocks).toHaveLength(0);
    expect(impossible.warnings[0].remaining_minutes).toBe(120);
  });
  it("handles daylight-saving boundaries in Vancouver", () => {
    for (const now of [
      "2025-11-01T15:00:00Z",
      "2025-03-08T15:00:00Z",
      "2026-10-31T15:00:00Z",
    ]) {
      const result = schedule(
        input({ now, tasks: [task("a", { estimated_minutes: 700 })] }),
      );
      expect(result.blocks.length).toBeGreaterThan(7);
      for (const b of result.blocks) {
        expect(
          Number(formatInTimeZone(b.start_at, TIMEZONE, "H")),
        ).toBeGreaterThanOrEqual(9);
        expect(
          Number(formatInTimeZone(b.end_at, TIMEZONE, "H")),
        ).toBeLessThanOrEqual(21);
      }
    }
  });
  it("does not double-count actual time, completed blocks, or existing reservations", () => {
    const result = schedule(
      input({
        tasks: [task("a", { estimated_minutes: 120, actual_minutes: 60 })],
        existing: [
          {
            task_id: "a",
            status: "completed",
            start_at: "2026-11-05T17:00:00Z",
            end_at: "2026-11-05T18:00:00Z",
          },
          {
            task_id: "a",
            status: "planned",
            start_at: "2026-11-06T17:00:00Z",
            end_at: "2026-11-06T17:30:00Z",
          },
        ],
      }),
    );
    expect(result.blocks.reduce((n, b) => n + b.minutes, 0)).toBe(30);
  });
  it("explains short remaining effort rather than silently dropping it", () => {
    const result = schedule(
      input({ tasks: [task("a", { estimated_minutes: 20 })] }),
    );
    expect(result.blocks).toHaveLength(0);
    expect(result.warnings[0].reason).toContain("shorter");
  });
});
