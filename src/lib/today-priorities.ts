import { formatInTimeZone } from "date-fns-tz";
import { deadlineInstant, isOverdue, localDate, TIMEZONE } from "./dates";
import type { Task, Workspace } from "./schemas";
/** A dated responsibility outranks an undated one; blocked work stays visible. */
export function todayPriorities(
  data: Pick<Workspace, "tasks" | "dependencies">,
  now = new Date(),
) {
  const active = data.tasks.filter(
    (t) => !t.deleted_at && !["completed", "cancelled"].includes(t.status),
  );
  const band = (t: Task) => {
    if (isOverdue(t, now)) return 0;
    const due = t.due_date ?? (t.due_at ? localDate(t.due_at) : null);
    if (due === localDate(now)) return 1;
    const instant = deadlineInstant(t);
    return instant && instant.getTime() - now.getTime() <= 48 * 3600000 ? 2 : 3;
  };
  return active
    .sort(
      (a, b) =>
        band(a) - band(b) ||
        b.priority - a.priority ||
        (a.priority_order ?? 100000) - (b.priority_order ?? 100000) ||
        (deadlineInstant(a)?.getTime() ?? Infinity) -
          (deadlineInstant(b)?.getTime() ?? Infinity) ||
        a.id.localeCompare(b.id),
    )
    .map((task) => {
      const blocked = data.dependencies.filter(
        (d) =>
          d.successor_task_id === task.id &&
          !data.tasks.some(
            (t) =>
              t.id === d.predecessor_task_id &&
              !t.deleted_at &&
              t.status === "completed",
          ),
      );
      const urgency = [
        "Overdue",
        "Due today",
        "Due within 48 hours",
        task.due_at || task.due_date
          ? "Upcoming responsibility"
          : "No deadline recorded",
      ][band(task)];
      const effort =
        task.estimated_minutes == null
          ? "Effort estimate missing"
          : task.actual_minutes == null
            ? `${task.estimated_minutes} min estimated; actual effort not recorded`
            : `${Math.max(0, task.estimated_minutes - task.actual_minutes)} min remaining from recorded effort`;
      return {
        task,
        blocked: blocked.length > 0,
        reason: `${urgency} · priority ${task.priority} · ${effort}`,
      };
    });
}
export function personalGreeting(name: string, now = new Date()) {
  const hour = Number(formatInTimeZone(now, TIMEZONE, "H"));
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${greeting}, ${first}.` : `${greeting}.`;
}
