import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Workspace, Task } from "./schemas";
import { workIntervals, type Policy, type Busy } from "./scheduler";
export type PlannedBlock = Busy & {
  id: string;
  task_id: string;
  status: string;
  actual_minutes?: number | null;
};
export type PlanEvent = {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day_start: string | null;
  all_day_end?: string | null;
  timezone: string;
  busy_status: string;
  work_session?: unknown;
};
export function shiftDay(day: string, n: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
export function weekOf(day: string) {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const start = shiftDay(day, -((weekday + 6) % 7));
  return { weekStart: start, weekEnd: shiftDay(start, 6) };
}
export function remainingEffort(
  task: Pick<Task, "estimated_minutes" | "actual_minutes">,
) {
  return task.estimated_minutes === null
    ? null
    : Math.max(0, task.estimated_minutes - (task.actual_minutes ?? 0));
}
export function unionIntervals(rows: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const row of rows
    .filter((r) => Number.isFinite(r.start) && r.end > r.start)
    .sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
    else merged.push({ ...row });
  }
  return merged;
}
/** One local date; a deadline is never interpreted as an allocated work block. */
export function todayPlan(input: {
  workspace: Pick<Workspace, "tasks" | "dependencies">;
  day: string;
  zone: string;
  now: Date;
  policy: Policy;
  blocks: PlannedBlock[];
  events: PlanEvent[];
  reliable: boolean;
}) {
  const { workspace, day, zone, now, policy } = input;
  const live = day === formatInTimeZone(now, zone, "yyyy-MM-dd"),
    past = day < formatInTimeZone(now, zone, "yyyy-MM-dd");
  const boundary = (date: string, hour: number) =>
    fromZonedTime(
      date + "T" + String(hour).padStart(2, "0") + ":00:00",
      zone,
    ).getTime();
  const start = boundary(day, policy.start_hour),
    end = boundary(day, policy.end_hour),
    dayStart = boundary(day, 0),
    dayEnd = boundary(shiftDay(day, 1), 0);
  const blocks = input.blocks.filter(
    (b) =>
      ["planned", "completed"].includes(b.status) &&
      Date.parse(b.start_at) < dayEnd &&
      Date.parse(b.end_at) > dayStart,
  );
  const plannedIds = new Set(
    blocks.filter((b) => b.status === "planned").map((b) => b.task_id),
  );
  const clip = (s: number, e: number) => ({
    start: Math.max(start, s),
    end: Math.min(end, e),
  });
  const plannedIntervals = unionIntervals(
    workIntervals(blocks, policy.break_minutes).map((b) =>
      clip(b.start, b.end),
    ),
  );
  const allocations: Record<string, number> = {};
  for (const block of new Map(
    blocks.filter((b) => b.status === "planned").map((b) => [b.id, b]),
  ).values())
    allocations[block.task_id] =
      (allocations[block.task_id] ?? 0) +
      Math.max(
        0,
        Math.min(dayEnd, Date.parse(block.end_at)) -
          Math.max(dayStart, Date.parse(block.start_at)),
      ) /
        60000;
  const plannedMinutes = Object.values(allocations).reduce((a, b) => a + b, 0);
  const fixed = input.events
    .filter((e) => e.busy_status === "busy" && !e.work_session)
    .map((e) => ({
      start: e.start_at
        ? Date.parse(e.start_at)
        : e.all_day_start
          ? fromZonedTime(e.all_day_start + "T00:00:00", e.timezone).getTime()
          : NaN,
      end: e.end_at
        ? Date.parse(e.end_at)
        : e.all_day_end
          ? fromZonedTime(e.all_day_end + "T00:00:00", e.timezone).getTime()
          : NaN,
      event: e,
    }))
    .filter((r) => r.start < dayEnd && r.end > dayStart);
  const occupied = unionIntervals([
    ...fixed.map((r) => clip(r.start, r.end)),
    ...plannedIntervals,
  ]);
  let cursor = Math.max(start, live ? now.getTime() : start);
  const gaps: { start: number; end: number }[] = [];
  for (const interval of occupied) {
    if (interval.end <= cursor) continue;
    if (interval.start > cursor)
      gaps.push({ start: cursor, end: Math.min(end, interval.start) });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  const completedMinutes = [
    ...new Map(
      blocks.filter((b) => b.status === "completed").map((b) => [b.id, b]),
    ).values(),
  ].reduce(
    (n, b) =>
      n +
      (b.actual_minutes ??
        Math.max(
          0,
          Math.min(dayEnd, Date.parse(b.end_at)) -
            Math.max(dayStart, Date.parse(b.start_at)),
        ) / 60000),
    0,
  );
  const cap = Math.max(
    0,
    policy.max_daily_minutes - plannedMinutes - completedMinutes,
  );
  const available =
    input.reliable && !past
      ? Math.min(
          cap,
          gaps.reduce((n, g) => n + Math.max(0, g.end - g.start) / 60000, 0),
        )
      : null;
  const gap =
    input.reliable && !past && gaps[0]
      ? {
          ...gaps[0],
          minutes: Math.min(cap, (gaps[0].end - gaps[0].start) / 60000),
        }
      : null;
  const active = workspace.tasks.filter(
    (t) =>
      !t.deleted_at &&
      !t.recurrence_rule_id &&
      !["completed", "cancelled"].includes(t.status),
  );
  const deadline = (t: Task) =>
    t.due_at ? formatInTimeZone(t.due_at, zone, "yyyy-MM-dd") : t.due_date;
  const pendingDependencies = (t: Task) =>
    workspace.dependencies.filter(
      (d) =>
        d.successor_task_id === t.id &&
        !workspace.tasks.some(
          (p) =>
            p.id === d.predecessor_task_id &&
            p.status === "completed" &&
            !p.deleted_at,
        ),
    );
  const blocking = (t: Task) =>
    pendingDependencies(t)
      .map((d) => workspace.tasks.find((p) => p.id === d.predecessor_task_id))
      .filter((t): t is Task => !!t);
  const waiting = active.filter((t) => pendingDependencies(t).length > 0);
  const ids = new Set(waiting.map((t) => t.id));
  const planned = active.filter((t) => plannedIds.has(t.id) && !ids.has(t.id));
  planned.forEach((t) => ids.add(t.id));
  const overdue = active.filter(
    (t) =>
      !ids.has(t.id) &&
      !!deadline(t) &&
      (deadline(t)! < day ||
        (live && !!t.due_at && Date.parse(t.due_at) < now.getTime())),
  );
  overdue.forEach((t) => ids.add(t.id));
  const due = active.filter((t) => !ids.has(t.id) && deadline(t) === day);
  due.forEach((t) => ids.add(t.id));
  const inbox = active.filter(
    (t) =>
      !plannedIds.has(t.id) && !deadline(t) && !pendingDependencies(t).length,
  );
  inbox.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
  const completed = workspace.tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.status === "completed" &&
      t.completed_at &&
      formatInTimeZone(t.completed_at, zone, "yyyy-MM-dd") === day,
  );
  const feasible = active
    .filter(
      (t) =>
        !pendingDependencies(t).length &&
        remainingEffort(t) !== null &&
        remainingEffort(t)! > 0 &&
        gap &&
        gap.start <= now.getTime() &&
        gap.minutes >=
          Math.min(remainingEffort(t)!, policy.min_session_minutes),
    )
    .sort(
      (a, b) =>
        Number(plannedIds.has(b.id)) - Number(plannedIds.has(a.id)) ||
        (deadline(a) ?? "9999").localeCompare(deadline(b) ?? "9999") ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    );
  const allocatedNow = live
    ? blocks
        .filter(
          (b) =>
            b.status === "planned" &&
            Date.parse(b.start_at) <= now.getTime() &&
            Date.parse(b.end_at) > now.getTime() &&
            !fixed.some(
              (event) =>
                event.start < Date.parse(b.end_at) && event.end > now.getTime(),
            ),
        )
        .map((b) => ({
          block: b,
          task: active.find((t) => t.id === b.task_id),
        }))
        .find((item) => item.task && !pendingDependencies(item.task).length)
    : undefined;
  const recommended = allocatedNow?.task ?? feasible[0];
  const focusMinutes = allocatedNow
    ? Math.max(
        0,
        (Date.parse(allocatedNow.block.end_at) - now.getTime()) / 60000,
      )
    : (gap?.minutes ?? null);
  if (recommended) {
    planned.sort(
      (a, b) =>
        Number(b.id === recommended.id) - Number(a.id === recommended.id),
    );
    overdue.sort(
      (a, b) =>
        Number(b.id === recommended.id) - Number(a.id === recommended.id),
    );
    due.sort(
      (a, b) =>
        Number(b.id === recommended.id) - Number(a.id === recommended.id),
    );
  }
  const next = fixed
    .filter((r) => r.end > now.getTime())
    .sort((a, b) => a.start - b.start)[0];
  return {
    live,
    past,
    planned,
    overdue,
    due,
    waiting,
    inbox,
    completed,
    blocking,
    plannedMinutes,
    completedMinutes,
    allocations,
    unknown: active.filter(
      (t) => plannedIds.has(t.id) && t.estimated_minutes === null,
    ).length,
    available,
    gap,
    next: live ? next : null,
    focusMinutes,
    allocatedNow: !!allocatedNow,
    recommendation: live ? (recommended ?? null) : null,
    week: weekOf(day),
  };
}
