import type { Task, Goal, Milestone } from "./schemas";
import { localDate, isOverdue } from "./dates";
export function goalProgress(
  goal: Goal,
  milestones: Milestone[],
): { label: string; percent: number | null } {
  if (goal.progress_type === "qualitative")
    return {
      label:
        goal.status === "completed"
          ? "Completed"
          : "Progress through reflection",
      percent: null,
    };
  if (goal.progress_type === "binary")
    return {
      label: goal.status === "completed" ? "Achieved" : "Not yet achieved",
      percent: goal.status === "completed" ? 100 : 0,
    };
  if (goal.progress_type === "numeric") {
    if (goal.current_value === null || goal.target_value === null)
      return { label: "No current value recorded", percent: null };
    return {
      label: `${goal.current_value} / ${goal.target_value} ${goal.unit ?? ""}`,
      percent: Math.max(
        0,
        Math.min(100, (goal.current_value / goal.target_value) * 100),
      ),
    };
  }
  const linked = milestones.filter(
    (m) => m.goal_id === goal.id && m.status !== "cancelled",
  );
  if (!linked.length)
    return { label: "No milestones linked yet", percent: null };
  const completed = linked.filter((m) => m.status === "completed").length;
  return {
    label: `${completed} of ${linked.length} milestones`,
    percent: (completed / linked.length) * 100,
  };
}
export function taskSummary(tasks: Task[], now = new Date()) {
  const active = tasks.filter(
    (t) => !t.deleted_at && !["completed", "cancelled"].includes(t.status),
  );
  const today = localDate(now);
  return {
    active,
    overdue: active.filter((t) => isOverdue(t, now)),
    dueToday: active.filter(
      (t) =>
        t.due_date === today || (t.due_at && localDate(t.due_at) === today),
    ),
  };
}
