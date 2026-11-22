import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
export const TIMEZONE = "America/Vancouver";
export function localDate(now: Date | string = new Date()) {
  return formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd");
}
export function friendlyDate(date: string | null) {
  if (!date) return "No deadline";
  if (date.length === 10)
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(date + "T12:00:00Z"));
  return formatInTimeZone(date, TIMEZONE, "MMM d, h:mm a");
}
export function isOverdue(
  task: {
    due_date: string | null;
    due_at: string | null;
    status: string;
    deleted_at: string | null;
  },
  now = new Date(),
) {
  return (
    !task.deleted_at &&
    !["completed", "cancelled"].includes(task.status) &&
    (task.due_at
      ? new Date(task.due_at) < now
      : !!task.due_date && task.due_date < localDate(now))
  );
}
export function deadlineInstant(task: {
  due_date: string | null;
  due_at: string | null;
}) {
  return task.due_at
    ? new Date(task.due_at)
    : task.due_date
      ? fromZonedTime(task.due_date + "T23:59:59", TIMEZONE)
      : null;
}

/** Keep an earlier personal preparation target; official dates remain separate records. */
export function preparationDeadline(
  task: { due_at: string | null; due_date: string | null },
  assessment: { due_at: string | null; due_date: string | null },
) {
  const official = deadlineInstant(assessment),
    personal = deadlineInstant(task);
  const selected =
    official && (!personal || official < personal) ? assessment : task;
  return { due_at: selected.due_at, due_date: selected.due_date };
}
