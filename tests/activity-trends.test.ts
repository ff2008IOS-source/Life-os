import { expect, it } from "vitest";
import { activityTrend } from "@/lib/activity-trends";
import type { Workspace } from "@/lib/schemas";
const data = {
  tasks: [
    { id: "task", status: "completed", completed_at: "2026-11-15T06:59:59Z" },
    {
      id: "template",
      recurrence_rule_id: "rule",
      status: "completed",
      completed_at: "2026-11-15T20:00Z",
    },
    {
      id: "deleted",
      deleted_at: "2026-11-15T01:00Z",
      status: "completed",
      completed_at: "2026-11-15T20:00Z",
    },
  ],
  occurrences: [
    {
      id: "one",
      task_id: "template",
      status: "completed",
      completed_at: "2026-11-15T20:00Z",
    },
  ],
} as unknown as Workspace;
it("counts recurring instances without double-counting templates, excludes deleted tasks and respects local dates", () => {
  const result = activityTrend(
    data,
    "2026-11-15",
    "2026-11-15",
    "America/Vancouver",
  );
  expect(result.total).toBe(1);
  expect(result.buckets[0]).toMatchObject({ tasks: 0, occurrences: 1 });
});
it("uses the selected date window with bounded chart buckets and transparent counts", () => {
  const result = activityTrend(data, "2026-01-01", "2026-12-31", "UTC");
  expect(result.buckets.length).toBeLessThanOrEqual(13);
  expect(result.total).toBe(2);
  expect(
    result.buckets.reduce((sum, b) => sum + b.tasks + b.occurrences, 0),
  ).toBe(result.total);
  expect(result.buckets.at(-1)?.end).toBe("2026-12-31");
});
it("suggests only evidence-based next actions with explicit missing task links", async () => {
  const { progressActions } = await import("@/lib/activity-trends");
  const workspace = {
    tasks: [
      {
        id: "late",
        title: "Known unfinished task",
        status: "planned",
        due_date: "2026-11-10",
      },
    ],
    goals: [{ id: "goal", title: "Owner priority", status: "active" }],
    goalTasks: [],
    milestones: [],
  } as unknown as Workspace;
  const actions = progressActions(
    workspace,
    new Date("2026-11-15T20:00Z"),
    "America/Vancouver",
  );
  expect(actions.map((a) => a.title)).toEqual([
    "Review 1 overdue task",
    "Give a goal a next action",
  ]);
  expect(actions[1].detail).toContain("no active linked task");
});
