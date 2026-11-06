import { formatInTimeZone } from "date-fns-tz";
import { deadlineInstant, TIMEZONE } from "./dates";
export const NOTIFICATION_CATEGORIES = [
  "deadlines",
  "integration",
  "weekly_review",
  "conflicts",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export function quietNow(now: Date, start: string | null, end: string | null) {
  if (!start || !end) return false;
  const time = formatInTimeZone(now, TIMEZONE, "HH:mm:ss");
  return start <= end
    ? time >= start && time < end
    : time >= start || time < end;
}
export function deadlineReminder(
  task: {
    id: string;
    title: string;
    due_at: string | null;
    due_date: string | null;
  },
  now: Date,
) {
  const due = deadlineInstant(task);
  if (!due) return null;
  const minutes = (due.getTime() - now.getTime()) / 60000;
  if (minutes > 1440 || minutes < -1440) return null;
  const window =
    minutes < 0 ? "overdue" : minutes <= 120 ? "two_hours" : "tomorrow";
  return {
    category: "deadlines" as const,
    title:
      window === "overdue"
        ? "A task is overdue"
        : window === "two_hours"
          ? "A deadline is approaching"
          : "A task is due within 24 hours",
    body: task.title,
    deduplication_key: `deadline:${task.id}:${due.toISOString()}:${window}`,
  };
}
export function validPushEndpoint(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(u.hostname) &&
      u.pathname.length > 1
    );
  } catch {
    return false;
  }
}
