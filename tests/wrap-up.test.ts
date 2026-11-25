import { expect, it } from "vitest";
import { wrapUp } from "@/lib/wrap-up";

const t = (id: string, v: Record<string, unknown> = {}) => ({
  id,
  title: id,
  status: "planned",
  completed_at: null,
  due_at: null,
  due_date: null,
  scheduling_mode: "manual",
  ...v,
});

it("closes the day from recorded tasks", () => {
  const now = new Date("2026-11-25T02:30:00Z"); // Nov 24, 6:30 PM Vancouver
  const r = wrapUp(
    [
      t("done", { status: "completed", completed_at: "2026-11-24T20:00:00Z" }),
      t("yesterday-done", {
        status: "completed",
        completed_at: "2026-11-23T20:00:00Z",
      }),
      t("due-today", { due_date: "2026-11-24" }),
      t("overdue", { due_date: "2026-11-20", scheduling_mode: "eligible" }),
      t("later", { due_date: "2026-11-30" }),
      t("doing", { status: "in_progress" }),
      t("gone", { due_date: "2026-11-24", deleted_at: "2026-11-24T01:00:00Z" }),
    ],
    now,
  );
  expect(r.show).toBe(true);
  expect(r.done.map((x) => x.id)).toEqual(["done"]);
  expect(r.open.map((x) => x.task.id)).toEqual([
    "due-today",
    "overdue",
    "doing",
  ]);
  expect(r.open.find((x) => x.task.id === "overdue")).toMatchObject({
    overdue: true,
    autoRescheduled: true,
  });
});

it("waits until the evening", () => {
  expect(wrapUp([], new Date("2026-11-24T20:00:00Z")).show).toBe(false); // noon
});
