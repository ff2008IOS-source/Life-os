import { z } from "zod";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { TIMEZONE, deadlineInstant, localDate } from "./dates";
export const policySchema = z
  .object({
    timezone: z.literal(TIMEZONE).default(TIMEZONE),
    start_hour: z.number().int().min(9).max(20).default(9),
    end_hour: z.number().int().min(10).max(21).default(21),
    max_daily_minutes: z.number().int().min(25).max(240).default(240),
    min_session_minutes: z.number().int().min(25).max(90).default(25),
    max_session_minutes: z.number().int().min(25).max(90).default(90),
    break_minutes: z.number().int().min(10).max(60).default(10),
    freeze_minutes: z.number().int().min(60).max(1440).default(60),
    scheduling_horizon_days: z.number().int().min(1).max(7).default(7),
    deadline_buffer_hours: z.number().int().min(0).max(24).default(24),
  })
  .strict()
  .refine(
    (p) =>
      p.end_hour > p.start_hour &&
      p.max_session_minutes >= p.min_session_minutes &&
      p.max_daily_minutes >= p.min_session_minutes,
    { message: "Check work windows and session limits." },
  );
export type Policy = z.infer<typeof policySchema>;
export const DEFAULT_POLICY: Policy = policySchema.parse({});
export type ScheduleTask = {
  id: string;
  title: string;
  status: string;
  area: string | null;
  eligible: boolean;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  priority: number;
  due_at: string | null;
  due_date: string | null;
  recurrence_rule_id?: string | null;
};
export type Busy = { start_at: string; end_at: string };
export type ExistingBlock = Busy & {
  task_id: string;
  status: "planned" | "completed";
};
export type ScheduleInput = {
  now: string;
  tasks: ScheduleTask[];
  busy: Busy[];
  existing: ExistingBlock[];
  dependencies: { predecessor_task_id: string; successor_task_id: string }[];
  policy: Policy;
};
export type ProposedBlock = Busy & {
  task_id: string;
  minutes: number;
  reason: string;
};
export type ScheduleWarning = {
  task_id: string;
  title: string;
  remaining_minutes: number | null;
  reason: string;
};
export type ScheduleResult = {
  blocks: ProposedBlock[];
  warnings: ScheduleWarning[];
  policy: Policy;
  availability_source: "test" | "google_calendar";
  run_id?: string;
  expires_at?: string;
  calendar_count?: number;
  generated_at: string;
};
const minute = 60000;
export function schedule(input: ScheduleInput): ScheduleResult {
  const policy = policySchema.parse(input.policy);
  const now = new Date(input.now);
  if (!Number.isFinite(now.getTime())) throw Error("Invalid current time");
  const reserved = input.existing.filter((b) => b.status === "planned");
  const occupied = [...input.busy, ...input.existing].map((b) => ({
    start: new Date(b.start_at).getTime(),
    end: new Date(b.end_at).getTime(),
  }));
  if (
    occupied.some(
      (b) =>
        !Number.isFinite(b.start) ||
        !Number.isFinite(b.end) ||
        b.end <= b.start,
    )
  )
    throw Error("Invalid availability time range");
  const blocks: ProposedBlock[] = [];
  const warnings: ScheduleWarning[] = [];
  const finished = new Map<string, number>();
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const cycles = new Set<string>();
  const ordered: ScheduleTask[] = [];
  const taskMap = new Map(input.tasks.map((t) => [t.id, t]));
  const dependencies = new Map<string, string[]>();
  input.dependencies.forEach((d) =>
    dependencies.set(d.successor_task_id, [
      ...(dependencies.get(d.successor_task_id) ?? []),
      d.predecessor_task_id,
    ]),
  );
  function visit(t: ScheduleTask) {
    if (visiting.has(t.id)) {
      for (const id of visiting) cycles.add(id);
      return;
    }
    if (seen.has(t.id)) return;
    visiting.add(t.id);
    for (const id of dependencies.get(t.id) ?? []) {
      const dep = taskMap.get(id);
      if (dep) visit(dep);
    }
    visiting.delete(t.id);
    seen.add(t.id);
    ordered.push(t);
  }
  const sorted = [...input.tasks].sort(
    (a, b) =>
      (deadlineInstant(a)?.getTime() ?? Infinity) -
        (deadlineInstant(b)?.getTime() ?? Infinity) ||
      b.priority - a.priority ||
      a.id.localeCompare(b.id),
  );
  sorted.forEach(visit);
  const days = Array.from({ length: policy.scheduling_horizon_days }, (_, i) =>
    new Date(Date.parse(localDate(now) + "T12:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const daily = new Map<string, number>();
  for (const b of input.existing) {
    for (const day of days) {
      const start = fromZonedTime(day + "T00:00:00", TIMEZONE).getTime();
      const end = fromZonedTime(
        new Date(Date.parse(day + "T12:00:00Z") + 86400000)
          .toISOString()
          .slice(0, 10) + "T00:00:00",
        TIMEZONE,
      ).getTime();
      const overlap =
        Math.max(
          0,
          Math.min(new Date(b.end_at).getTime(), end) -
            Math.max(new Date(b.start_at).getTime(), start),
        ) / minute;
      daily.set(day, (daily.get(day) ?? 0) + overlap);
    }
  }
  for (const task of ordered) {
    if (task.status === "completed") {
      finished.set(task.id, now.getTime());
      continue;
    }
    if (task.status === "cancelled") continue;
    if (!task.eligible) continue;
    const warn = (reason: string, remaining: number | null) =>
      warnings.push({
        task_id: task.id,
        title: task.title,
        remaining_minutes: remaining,
        reason,
      });
    if (task.recurrence_rule_id) {
      warn(
        "Recurring templates require occurrence-specific work blocks; plan their generated occurrences manually in this beta.",
        task.estimated_minutes,
      );
      continue;
    }
    if (!["academics", "career", "projects"].includes(task.area ?? "")) {
      warn(
        "This life area is excluded from automatic scheduling.",
        task.estimated_minutes,
      );
      continue;
    }
    if (cycles.has(task.id)) {
      warn("Circular task dependency detected.", task.estimated_minutes);
      continue;
    }
    if (!task.estimated_minutes) {
      warn("Add an estimated duration before scheduling.", null);
      continue;
    }
    const deps = dependencies.get(task.id) ?? [];
    if (deps.some((id) => !finished.has(id))) {
      warn(
        "A prerequisite is missing, excluded, cancelled, or cannot be completed in this plan.",
        task.estimated_minutes,
      );
      continue;
    }
    const completed = input.existing
      .filter((b) => b.task_id === task.id && b.status === "completed")
      .reduce(
        (sum, b) =>
          sum +
          (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) /
            minute,
        0,
      );
    const planned = reserved.filter((b) => b.task_id === task.id);
    let remaining = Math.max(
      0,
      task.estimated_minutes -
        Math.max(task.actual_minutes ?? 0, completed) -
        planned.reduce(
          (sum, b) =>
            sum +
            (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) /
              minute,
          0,
        ),
    );
    let latest = Math.max(
      now.getTime(),
      ...planned.map((b) => new Date(b.end_at).getTime()),
      ...deps.map((id) => finished.get(id)!),
    );
    if (remaining === 0) {
      finished.set(task.id, latest);
      continue;
    }
    const deadline = deadlineInstant(task)?.getTime() ?? Infinity;
    const earliest = Math.max(
      now.getTime() + policy.freeze_minutes * minute,
      ...deps.map((id) => finished.get(id)!),
    );
    function place(until: number) {
      for (const day of days) {
        if (remaining < policy.min_session_minutes) break;
        const windowStart = fromZonedTime(
          `${day}T${String(policy.start_hour).padStart(2, "0")}:00:00`,
          TIMEZONE,
        ).getTime();
        const windowEnd = Math.min(
          fromZonedTime(
            `${day}T${String(policy.end_hour).padStart(2, "0")}:00:00`,
            TIMEZONE,
          ).getTime(),
          until,
        );
        let cursor =
          Math.ceil(Math.max(windowStart, earliest) / minute) * minute;
        while (
          remaining >= policy.min_session_minutes &&
          cursor + policy.min_session_minutes * minute <= windowEnd
        ) {
          const capacity = policy.max_daily_minutes - (daily.get(day) ?? 0);
          if (capacity < policy.min_session_minutes) break;
          let minutes = Math.min(
            remaining,
            policy.max_session_minutes,
            capacity,
          );
          if (
            remaining > minutes &&
            remaining - minutes < policy.min_session_minutes
          )
            minutes = remaining - policy.min_session_minutes;
          if (minutes < policy.min_session_minutes) break;
          const protectedIntervals = [
            ...occupied,
            ...blocks.map((b) => ({
              start: new Date(b.start_at).getTime(),
              end: new Date(b.end_at).getTime(),
            })),
          ].sort((a, b) => a.start - b.start);
          // Breaks apply between automatically scheduled work blocks, including existing ones.
          const auto = [...input.existing, ...blocks].map((b) => ({
            start:
              new Date(b.start_at).getTime() - policy.break_minutes * minute,
            end: new Date(b.end_at).getTime() + policy.break_minutes * minute,
          }));
          const intervals = [...protectedIntervals, ...auto].sort(
            (a, b) => a.start - b.start,
          );
          const overlap = intervals.find(
            (b) => cursor < b.end && cursor + minutes * minute > b.start,
          );
          if (overlap) {
            const available = Math.floor((overlap.start - cursor) / minute);
            if (available >= policy.min_session_minutes) {
              minutes = Math.min(minutes, available);
              if (
                remaining > minutes &&
                remaining - minutes < policy.min_session_minutes
              ) {
                minutes = remaining - policy.min_session_minutes;
              }
              if (minutes < policy.min_session_minutes) {
                cursor = overlap.end;
                continue;
              }
            } else {
              cursor = Math.max(cursor + minute, overlap.end);
              continue;
            }
          }
          minutes = Math.min(
            minutes,
            Math.floor((windowEnd - cursor) / minute),
          );
          if (minutes < policy.min_session_minutes) break;
          if (
            remaining > minutes &&
            remaining - minutes < policy.min_session_minutes
          ) {
            minutes = remaining - policy.min_session_minutes;
            if (minutes < policy.min_session_minutes) break;
          }
          const end = cursor + minutes * minute;
          blocks.push({
            task_id: task.id,
            start_at: new Date(cursor).toISOString(),
            end_at: new Date(end).toISOString(),
            minutes,
            reason:
              until < deadline
                ? "Before preferred deadline buffer"
                : "Earliest feasible time within hard constraints",
          });
          daily.set(day, (daily.get(day) ?? 0) + minutes);
          remaining -= minutes;
          latest = Math.max(latest, end);
          cursor = end + policy.break_minutes * minute;
        }
      }
    }
    if (Number.isFinite(deadline) && policy.deadline_buffer_hours)
      place(deadline - policy.deadline_buffer_hours * 60 * minute);
    if (remaining >= policy.min_session_minutes) place(deadline);
    if (remaining > 0)
      warn(
        remaining < policy.min_session_minutes
          ? "Remaining effort is shorter than the minimum session. Adjust the estimate or plan manually."
          : "Insufficient free time before the deadline within work windows, breaks, daily cap, and horizon.",
        remaining,
      );
    else finished.set(task.id, latest);
  }
  return {
    blocks,
    warnings,
    policy,
    availability_source: "test",
    generated_at: input.now,
  };
}
export function blockLocalLabel(block: Busy) {
  return `${formatInTimeZone(block.start_at, TIMEZONE, "EEE, MMM d · h:mm a")}–${formatInTimeZone(block.end_at, TIMEZONE, "h:mm a")}`;
}
