import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Goal, Milestone, Task } from "./schemas";

/**
 * Pure model behind the Today screen: free windows, clashes, suggested work
 * blocks, the single "do this next" pick, deadlines and weekly progress.
 * Suggestions are previews only; nothing here writes to a calendar.
 */

export type AgendaEvent = {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day_start: string | null;
  busy_status?: string | null;
  /** Repeats week to week; two repeating events overlapping are not a clash. */
  recurring?: boolean;
  /** Set when the event is a Life OS work session; its block represents it. */
  work_session?: unknown;
};
export type AgendaBlock = {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: string;
};
export type AgendaAssessment = {
  id: string;
  title: string;
  course: string;
  course_id: string;
  task_id: string | null;
  due_at: string | null;
  due_date: string | null;
  submission_state: string;
  earned_score?: number | null;
  maximum_score?: number | null;
  version?: number;
};
export type AgendaInput = {
  now: Date;
  zone: string;
  events: AgendaEvent[];
  calendars: { id: string; name: string }[];
  assessments: AgendaAssessment[];
  tasks: Task[];
  goals: Goal[];
  goalTasks: { goal_id: string; task_id: string }[];
  milestones: Milestone[];
  /** Successors are not suggested until every predecessor is finished. */
  dependencies?: { predecessor_task_id: string; successor_task_id: string }[];
  focusMinutesThisWeek: number;
  /** Work sessions already reserved on the Life OS calendar. */
  blocks?: AgendaBlock[];
  /** Earliest and latest local hour suggestions may use. */
  dayStartHour?: number;
  dayEndHour?: number;
  /** Most suggested minutes for one day. */
  dailyCap?: number;
};

export type WorkItem = {
  key: string;
  kind: "assessment" | "task";
  id: string;
  task_id: string | null;
  title: string;
  label: string;
  due: number | null;
  dueText: string;
  minutes: number;
  version?: number;
  /** Goals this work moves forward. */
  goals: { id: string; title: string }[];
  /** 1 (low) to 4 (urgent); graded work counts as high. */
  priority: number;
};
export type TimelineEntry =
  | {
      kind: "event";
      id: string;
      start: number;
      end: number;
      title: string;
      meta: string;
      clash: boolean;
    }
  | {
      kind: "work";
      id: string;
      start: number;
      end: number;
      item: WorkItem;
      part: number;
      parts: number;
      /** True for a reserved session, false for a suggestion. */
      planned: boolean;
    };
export type Gap = { start: number; end: number; minutes: number };
export type Clash = {
  a: { title: string; start: number; end: number };
  b: { title: string; start: number; end: number };
  at: number;
  nextFree: Gap | null;
};
export type DueEntry = {
  key: string;
  title: string;
  label: string;
  due: number;
  dueText: string;
  urgent: boolean;
  status: "done" | "planned" | "unplanned";
  plannedAt: number | null;
  href: string;
};
export type GoalNudge =
  | { kind: "overdue"; goal: Goal; daysLate: number }
  | { kind: "no-next-step"; goal: Goal };

const MIN_BLOCK = 25;
const MAX_BLOCK = 90;
const BREAK = 10;
/** Time to move, change or reset after a commitment before work starts. */
const TRANSITION = 10;
const DONE_STATES = ["submitted", "returned", "excused", "graded"];

export function localDay(ms: number | Date, zone: string) {
  return formatInTimeZone(ms, zone, "yyyy-MM-dd");
}
function addDays(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function at(day: string, hour: number, zone: string) {
  const h = String(Math.floor(hour)).padStart(2, "0");
  const m = String(Math.round((hour % 1) * 60)).padStart(2, "0");
  return fromZonedTime(`${day}T${h}:${m}:00`, zone).getTime();
}
const roundUp = (ms: number, step = 5 * 60000) => Math.ceil(ms / step) * step;

/** "today 4:20 PM", "tomorrow 11:59 PM", "Wed 11:59 PM", "Nov 30". */
export function relativeDue(
  due: number,
  hasTime: boolean,
  now: Date,
  zone: string,
) {
  const today = localDay(now, zone);
  const day = localDay(due, zone);
  const time = hasTime ? " " + formatInTimeZone(due, zone, "h:mm a") : "";
  if (day < today)
    return `overdue since ${formatInTimeZone(due, zone, "MMM d")}`;
  if (day === today) return `today${time}`;
  if (day === addDays(today, 1)) return `tomorrow${time}`;
  if (day <= addDays(today, 6))
    return formatInTimeZone(due, zone, "EEE") + time;
  return formatInTimeZone(due, zone, "MMM d");
}

function dueOf(
  x: { due_at: string | null; due_date: string | null },
  zone: string,
) {
  if (x.due_at) return { ms: Date.parse(x.due_at), timed: true };
  if (x.due_date)
    return {
      ms: fromZonedTime(x.due_date + "T23:59:00", zone).getTime(),
      timed: false,
    };
  return null;
}

function remaining(task: Task | undefined, fallback: number) {
  if (!task?.estimated_minutes) return fallback;
  return Math.max(
    MIN_BLOCK,
    task.estimated_minutes - (task.actual_minutes ?? 0),
  );
}

export function buildAgenda(input: AgendaInput) {
  const { now, zone } = input;
  const nowMs = now.getTime();
  const today = localDay(now, zone);
  const dayStart = at(today, 0, zone);
  const dayEnd = at(addDays(today, 1), 0, zone);
  const workStart = Math.max(
    roundUp(nowMs),
    at(today, input.dayStartHour ?? 8, zone),
  );
  const workEnd = at(today, input.dayEndHour ?? 22, zone);
  const calendarName = (id: string) =>
    input.calendars.find((c) => c.id === id)?.name.trim() ?? "Calendar";

  // Today's timed, busy events.
  const timed = input.events
    .filter(
      (e) =>
        e.start_at &&
        e.end_at &&
        !e.all_day_start &&
        e.busy_status !== "free" &&
        !e.work_session &&
        Date.parse(e.end_at) > dayStart &&
        Date.parse(e.start_at) < dayEnd,
    )
    .map((e) => ({
      id: e.id,
      title: e.title,
      start: Date.parse(e.start_at!),
      end: Date.parse(e.end_at!),
      meta: calendarName(e.calendar_id),
      recurring: !!e.recurring,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    // The same event copied onto several calendars shows once.
    .filter(
      (e, i, all) =>
        !all
          .slice(0, i)
          .some(
            (o) =>
              o.title === e.title && o.start === e.start && o.end === e.end,
          ),
    );
  const allDay = input.events
    .filter((e) => e.all_day_start === today)
    .map((e) => e.title);

  // Clashes between different events (skip identical duplicates across calendars).
  const clashes: Clash[] = [];
  const clashing = new Set<string>();
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i],
        b = timed[j];
      if (b.start >= a.end) break;
      if (a.title === b.title && a.start === b.start) continue;
      // Standing weekly overlaps are known; only a one-off event makes a clash.
      if (a.recurring && b.recurring) continue;
      clashing.add(a.id).add(b.id);
      if (a.end > nowMs)
        clashes.push({
          a: { title: a.title, start: a.start, end: a.end },
          b: { title: b.title, start: b.start, end: b.end },
          at: b.start,
          nextFree: null,
        });
    }

  // Reserved work sessions occupy time and take priority over suggestions.
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const reserved = (input.blocks ?? [])
    .filter(
      (b) =>
        b.status === "planned" &&
        Date.parse(b.end_at) > dayStart &&
        Date.parse(b.start_at) < dayEnd &&
        taskById.has(b.task_id),
    )
    .map((b) => ({
      ...b,
      start: Date.parse(b.start_at),
      end: Date.parse(b.end_at),
    }))
    .sort((a, b) => a.start - b.start);
  const reservedTasks = new Set(reserved.map((b) => b.task_id));
  const occupied = [...timed, ...reserved].sort((a, b) => a.start - b.start);

  // Free windows inside the working day.
  const gaps: Gap[] = [];
  let cursor = workStart;
  for (const e of occupied) {
    if (e.end + TRANSITION * 60000 <= cursor) continue;
    if (e.start - cursor >= MIN_BLOCK * 60000 && e.start <= workEnd)
      gaps.push({
        start: cursor,
        end: e.start,
        minutes: (e.start - cursor) / 60000,
      });
    cursor = Math.max(cursor, e.end + TRANSITION * 60000);
  }
  if (workEnd - cursor >= MIN_BLOCK * 60000)
    gaps.push({
      start: cursor,
      end: workEnd,
      minutes: (workEnd - cursor) / 60000,
    });
  for (const c of clashes) {
    const length = Math.min(c.a.end - c.a.start, c.b.end - c.b.start);
    c.nextFree =
      gaps.find((g) => g.start >= c.at && g.end - g.start >= length) ?? null;
  }

  // Work that is open and due within a week (or overdue).
  const horizon = at(addDays(today, 8), 0, zone);
  const assessmentTasks = new Set(
    input.assessments.map((a) => a.task_id).filter(Boolean) as string[],
  );
  const goalsFor = (taskId: string | null) =>
    taskId
      ? input.goalTasks
          .filter((l) => l.task_id === taskId)
          .map((l) => input.goals.find((g) => g.id === l.goal_id))
          .filter((g): g is Goal => !!g && g.status === "active")
          .map((g) => ({ id: g.id, title: g.title }))
      : [];
  const waiting = (taskId: string) =>
    (input.dependencies ?? []).some((d) => {
      if (d.successor_task_id !== taskId) return false;
      const before = taskById.get(d.predecessor_task_id);
      return (
        !before ||
        (!before.deleted_at &&
          !["completed", "cancelled"].includes(before.status))
      );
    });
  const items: WorkItem[] = [];
  for (const a of input.assessments) {
    if (DONE_STATES.includes(a.submission_state)) continue;
    const d = dueOf(a, zone);
    if (!d || d.ms < dayStart - 3 * 86400000 || d.ms >= horizon) continue;
    const task = a.task_id ? taskById.get(a.task_id) : undefined;
    if (task && (task.status === "completed" || task.status === "cancelled"))
      continue;
    if (a.task_id && reservedTasks.has(a.task_id)) continue;
    items.push({
      key: "a:" + a.id,
      kind: "assessment",
      id: a.id,
      task_id: a.task_id,
      title: a.title,
      label: a.course,
      due: d.ms,
      dueText: relativeDue(d.ms, d.timed, now, zone),
      minutes: remaining(task, 60),
      version: a.version,
      goals: goalsFor(a.task_id),
      priority: task?.priority ?? 3,
    });
  }
  for (const t of input.tasks) {
    if (
      t.deleted_at ||
      assessmentTasks.has(t.id) ||
      reservedTasks.has(t.id) ||
      waiting(t.id) ||
      ["completed", "cancelled"].includes(t.status)
    )
      continue;
    const d = dueOf(t, zone);
    const inFocus =
      t.status === "in_progress" || t.status === "planned" || t.priority >= 4;
    if (d ? d.ms >= horizon : !inFocus) continue;
    items.push({
      key: "t:" + t.id,
      kind: "task",
      id: t.id,
      task_id: t.id,
      title: t.title,
      label: t.priority >= 3 ? "High priority" : "Task",
      due: d?.ms ?? null,
      dueText: d ? relativeDue(d.ms, d.timed, now, zone) : "no deadline",
      minutes: remaining(t, 30),
      version: t.version,
      goals: goalsFor(t.id),
      priority: t.priority,
    });
  }
  // Overdue work first, most urgent first; then by deadline.
  const overdue = (i: WorkItem) => i.due !== null && i.due < nowMs;
  items.sort(
    (a, b) =>
      Number(overdue(b)) - Number(overdue(a)) ||
      (overdue(a) ? b.priority - a.priority : 0) ||
      (a.due ?? Infinity) - (b.due ?? Infinity) ||
      b.priority - a.priority ||
      b.minutes - a.minutes,
  );

  // Greedy placement: soonest deadline first, longest piece into the first window that fits.
  const cap = input.dailyCap ?? 240;
  const free = gaps.map((g) => ({ ...g, cursor: g.start }));
  const blocks: Extract<TimelineEntry, { kind: "work" }>[] = [];
  let used = 0;
  for (const item of items) {
    let left = item.minutes;
    const parts: { start: number; end: number }[] = [];
    for (const g of free) {
      if (left < 1 || used >= cap || parts.length >= 2) break;
      // Never plan past a deadline that is still ahead; overdue work can go anywhere.
      if (item.due !== null && item.due > nowMs && g.cursor >= item.due)
        continue;
      const room = (g.end - g.cursor) / 60000;
      if (room < MIN_BLOCK) continue;
      const length = Math.min(left, room, MAX_BLOCK, cap - used);
      if (length < MIN_BLOCK) continue;
      parts.push({ start: g.cursor, end: g.cursor + length * 60000 });
      g.cursor += (length + BREAK) * 60000;
      left -= length;
      used += length;
    }
    parts.forEach((p, i) =>
      blocks.push({
        kind: "work",
        id: `${item.key}:${i}`,
        start: p.start,
        end: p.end,
        item,
        part: i + 1,
        parts: parts.length,
        planned: false,
      }),
    );
  }
  const assessmentFor = (taskId: string) =>
    input.assessments.find((a) => a.task_id === taskId);
  const reservedEntries: Extract<TimelineEntry, { kind: "work" }>[] =
    reserved.map((b) => {
      const t = taskById.get(b.task_id)!;
      const a = assessmentFor(t.id);
      const d = dueOf(a ?? t, zone);
      return {
        kind: "work",
        id: "b:" + b.id,
        start: b.start,
        end: b.end,
        planned: true,
        part: 1,
        parts: 1,
        item: {
          key: "t:" + t.id,
          kind: "task",
          id: t.id,
          task_id: t.id,
          title: a?.title ?? t.title,
          label: a?.course ?? "Planned",
          due: d?.ms ?? null,
          dueText: d ? relativeDue(d.ms, d.timed, now, zone) : "no deadline",
          minutes: Math.round((b.end - b.start) / 60000),
          version: t.version,
          goals: goalsFor(t.id),
          priority: t.priority,
        },
      };
    });

  const timeline: TimelineEntry[] = [
    ...timed
      .filter((e) => e.end > dayStart)
      .map((e) => ({
        kind: "event" as const,
        id: e.id,
        start: e.start,
        end: e.end,
        title: e.title,
        meta: e.meta,
        clash: clashing.has(e.id),
      })),
    ...blocks,
    ...reservedEntries,
  ].sort((a, b) => a.start - b.start);

  // The one thing to do next, with alternates for the same window.
  const first =
    [...reservedEntries.filter((r) => r.end > nowMs), ...blocks].sort(
      (a, b) => a.start - b.start,
    )[0] ?? null;
  const gap = first
    ? first.planned
      ? {
          start: Math.max(first.start, nowMs),
          end: first.end,
          minutes: (first.end - Math.max(first.start, nowMs)) / 60000,
        }
      : (gaps.find((g) => g.start <= first.start && g.end >= first.end) ?? null)
    : (gaps[0] ?? null);
  const nextEvent = gap
    ? (timed.find((e) => e.start >= gap.end) ?? null)
    : null;
  const pickFor = (item: WorkItem) => ({
    item,
    minutes: Math.max(
      MIN_BLOCK,
      Math.min(item.minutes, gap ? gap.minutes : item.minutes, MAX_BLOCK),
    ),
  });
  const next = first
    ? [
        pickFor(first.item),
        ...items
          .filter((i) => i.key !== first.item.key)
          .slice(0, 2)
          .map(pickFor),
      ]
    : // No window left today: still name the most pressing work.
      items.slice(0, 3).map(pickFor);

  // Deadlines in the next seven days.
  const plannedAt = new Map<string, number>();
  for (const b of [...reservedEntries, ...blocks].sort(
    (x, y) => x.start - y.start,
  )) {
    const a = b.item.task_id ? assessmentFor(b.item.task_id) : undefined;
    const key =
      b.item.kind === "assessment" ? b.item.key : a ? "a:" + a.id : b.item.key;
    if (!plannedAt.has(key)) plannedAt.set(key, b.start);
  }
  const due: DueEntry[] = input.assessments
    .map((a) => ({ a, d: dueOf(a, zone) }))
    .filter(({ d }) => d && d.ms >= nowMs - 3600000 && d.ms < horizon)
    .map(({ a, d }) => {
      const done = DONE_STATES.includes(a.submission_state);
      const when = plannedAt.get("a:" + a.id) ?? null;
      return {
        key: a.id,
        title: a.title,
        label: a.course,
        due: d!.ms,
        dueText: relativeDue(d!.ms, d!.timed, now, zone),
        urgent: !done && d!.ms - nowMs < 36 * 3600000,
        status: done
          ? ("done" as const)
          : when
            ? ("planned" as const)
            : ("unplanned" as const),
        plannedAt: when,
        href: `/areas/academics?course=${a.course_id}&assessment=${a.id}`,
      };
    })
    .sort((a, b) => a.due - b.due);

  // This week (Monday–Sunday).
  const weekday = Number(formatInTimeZone(now, zone, "i"));
  const weekStartDay = addDays(today, 1 - weekday);
  const weekStart = at(weekStartDay, 0, zone);
  const weekEnd = at(addDays(weekStartDay, 7), 0, zone);
  const inWeek = (ms: number | null) =>
    ms !== null && ms >= weekStart && ms < weekEnd;
  const weekDeadlines = input.assessments.filter((a) =>
    inWeek(dueOf(a, zone)?.ms ?? null),
  );
  const activeGoals = input.goals.filter(
    (g) => g.status === "active" && !g.is_example,
  );
  const movedGoals = activeGoals.filter(
    (g) =>
      input.goalTasks.some((l) => {
        if (l.goal_id !== g.id) return false;
        const t = taskById.get(l.task_id);
        return !!t?.completed_at && inWeek(Date.parse(t.completed_at));
      }) ||
      input.milestones.some(
        (m) =>
          m.goal_id === g.id &&
          !!m.completed_at &&
          inWeek(Date.parse(m.completed_at)),
      ),
  );
  const week = {
    start: weekStart,
    end: weekEnd - 1,
    focusMinutes: input.focusMinutesThisWeek,
    deadlinesDone: weekDeadlines.filter((a) =>
      DONE_STATES.includes(a.submission_state),
    ).length,
    deadlinesTotal: weekDeadlines.length,
    goalsMoved: movedGoals.length,
    goalsTotal: activeGoals.length,
    tasksDone: input.tasks.filter(
      (t) =>
        !t.deleted_at && t.completed_at && inWeek(Date.parse(t.completed_at)),
    ).length,
  };

  // Goals that need a decision or a next step.
  const openTask = (g: Goal) =>
    input.goalTasks.some((l) => {
      const t = l.goal_id === g.id ? taskById.get(l.task_id) : undefined;
      return (
        !!t && !t.deleted_at && !["completed", "cancelled"].includes(t.status)
      );
    });
  const nudges: GoalNudge[] = [
    ...activeGoals
      .filter((g) => g.target_date && g.target_date < today)
      .sort((a, b) => a.target_date!.localeCompare(b.target_date!))
      .map((goal) => ({
        kind: "overdue" as const,
        goal,
        daysLate: Math.round(
          (Date.parse(today + "T12:00:00Z") -
            Date.parse(goal.target_date! + "T12:00:00Z")) /
            86400000,
        ),
      })),
    ...activeGoals
      .filter((g) => !(g.target_date && g.target_date < today) && !openTask(g))
      .sort((a, b) =>
        (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"),
      )
      .map((goal) => ({ kind: "no-next-step" as const, goal })),
  ];

  const inbox = input.tasks
    .filter((t) => !t.deleted_at && t.status === "inbox")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const nextEventAfterNow = timed.find((e) => e.end > nowMs) ?? null;
  return {
    today,
    timeline,
    allDay,
    gaps,
    clashes,
    items,
    next,
    nextWindow: gap,
    nextEvent,
    current:
      nextEventAfterNow && nextEventAfterNow.start <= nowMs
        ? nextEventAfterNow
        : null,
    due,
    week,
    nudges,
    inbox,
    suggestedMinutes: used,
    eventCount: timed.filter((e) => e.start >= dayStart).length,
  };
}
export type Agenda = ReturnType<typeof buildAgenda>;
