import { formatInTimeZone } from "date-fns-tz";
import { addDays, format } from "date-fns";
import type { Workspace } from "./schemas";
/** Counts reported completion timestamps, not productive hours, mastery or undocumented work. */
export function activityTrend(
  workspace: Workspace,
  start: string,
  end: string,
  timezone: string,
) {
  const span = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const bucketDays = span <= 7 ? 1 : span <= 31 ? 7 : span <= 120 ? 14 : 30;
  const completed = workspace.tasks
    .filter(
      (t) =>
        !t.deleted_at &&
        !t.recurrence_rule_id &&
        t.status === "completed" &&
        t.completed_at,
    )
    .map((t) => ({
      date: formatInTimeZone(t.completed_at!, timezone, "yyyy-MM-dd"),
      kind: "task",
    }));
  const ids = new Set(
    workspace.tasks.filter((t) => !t.deleted_at).map((t) => t.id),
  );
  const occurrences = workspace.occurrences
    .filter(
      (o) => ids.has(o.task_id) && o.status === "completed" && o.completed_at,
    )
    .map((o) => ({
      date: formatInTimeZone(o.completed_at!, timezone, "yyyy-MM-dd"),
      kind: "occurrence",
    }));
  const dates = [...completed, ...occurrences].filter(
    (x) => x.date >= start && x.date <= end,
  );
  const plus = (day: string, n: number) =>
    format(addDays(new Date(day + "T12:00:00"), n), "yyyy-MM-dd");
  const buckets = [];
  for (let date = start; date <= end; date = plus(date, bucketDays)) {
    const last =
      plus(date, bucketDays - 1) > end ? end : plus(date, bucketDays - 1);
    const rows = dates.filter((x) => x.date >= date && x.date <= last);
    buckets.push({
      start: date,
      end: last,
      count: rows.length,
      tasks: rows.filter((x) => x.kind === "task").length,
      occurrences: rows.filter((x) => x.kind === "occurrence").length,
    });
  }
  return { buckets, total: dates.length, bucketDays, start, end, timezone };
}

export function progressActions(
  workspace: Workspace,
  now: Date,
  timezone: string,
) {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const actions: { title: string; detail: string; href: string }[] = [];
  const overdue = workspace.tasks.filter(
    (t) =>
      !t.deleted_at &&
      !t.recurrence_rule_id &&
      !["completed", "cancelled"].includes(t.status) &&
      (t.due_at
        ? Date.parse(t.due_at) < now.getTime()
        : !!t.due_date && t.due_date < today),
  );
  if (overdue.length)
    actions.push({
      title: `Review ${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"}`,
      detail: `Start with ${overdue[0].title}. Confirm a realistic next step or reschedule it.`,
      href: "/planner?section=tasks",
    });
  const goal = workspace.goals.find(
    (g) =>
      g.status === "active" &&
      !workspace.goalTasks.some(
        (link) =>
          link.goal_id === g.id &&
          workspace.tasks.some(
            (t) =>
              t.id === link.task_id &&
              !t.deleted_at &&
              !["completed", "cancelled"].includes(t.status),
          ),
      ),
  );
  if (goal)
    actions.push({
      title: "Give a goal a next action",
      detail: `${goal.title} has no active linked task. Add one small action if this goal is still a priority.`,
      href: `/goals#goal-${goal.id}`,
    });
  const milestones = workspace.milestones
    .filter(
      (m) =>
        m.status === "planned" &&
        m.target_date &&
        m.target_date >= today &&
        Date.parse(m.target_date) - Date.parse(today) <= 7 * 86400000,
    )
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!));
  if (milestones.length)
    actions.push({
      title: "Prepare your next milestone",
      detail: `${milestones[0].title} is due ${milestones[0].target_date}. Check its next action.`,
      href: milestones[0].goal_id
        ? `/goals#goal-${milestones[0].goal_id}`
        : "/areas/projects",
    });
  return actions.slice(0, 3);
}
