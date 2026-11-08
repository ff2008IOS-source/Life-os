import { expect, it } from "vitest";
import { todayPriorities, personalGreeting } from "@/lib/today-priorities";
import { taskInput, type Task } from "@/lib/schemas";
const now = new Date("2026-11-08T18:00Z");
const task = (id: string, values = {}): Task => ({
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
});
it("ranks deadline urgency ahead of undated high priority and keeps blocked tasks visible", () => {
  const tasks = [
    task("undated", { priority: 4 }),
    task("today", { due_date: "2026-11-08" }),
    task("overdue", { due_date: "2026-11-07" }),
    task("done", { status: "completed" }),
    task("deleted", { deleted_at: now.toISOString() }),
  ];
  const ranked = todayPriorities(
    {
      tasks,
      dependencies: [
        { predecessor_task_id: "missing", successor_task_id: "overdue" },
      ],
    },
    now,
  );
  expect(ranked.map((x) => x.task.id)).toEqual(["overdue", "today", "undated"]);
  expect(ranked.find((x) => !x.blocked)?.task.id).toBe("today");
  expect(ranked[1].reason).toContain("Effort estimate missing");
});
it("only a recorded completed predecessor releases a dependency, never a deleted record", () => {
  const tasks = [
    task("dependency", { status: "completed" }),
    task("work", { estimated_minutes: 60, actual_minutes: null }),
  ];
  const dependencies = [
    { predecessor_task_id: "dependency", successor_task_id: "work" },
  ];
  expect(todayPriorities({ tasks, dependencies }, now)[0]).toMatchObject({
    blocked: false,
  });
  expect(todayPriorities({ tasks, dependencies }, now)[0].reason).toContain(
    "actual effort not recorded",
  );
  tasks[0].deleted_at = now.toISOString();
  expect(todayPriorities({ tasks, dependencies }, now)[0].blocked).toBe(true);
});
it("uses Vancouver time across midnight and daylight saving and respects known zero effort", () => {
  expect(personalGreeting("Fela Example", new Date("2026-11-08T06:30Z"))).toBe(
    "Good evening, Fela.",
  );
  expect(personalGreeting("", now)).toBe("Good morning.");
  const ranked = todayPriorities(
    {
      tasks: [
        task("work", {
          estimated_minutes: 30,
          actual_minutes: 10,
          due_at: "2026-11-08T19:00:00Z",
        }),
      ],
      dependencies: [],
    },
    now,
  );
  expect(ranked[0].reason).toContain("Due today");
  expect(ranked[0].reason).toContain("20 min remaining");
});
