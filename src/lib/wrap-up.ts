import { formatInTimeZone } from "date-fns-tz";

/**
 * The evening wrap-up: what got done today and what's still open, so the
 * day can be closed in a minute. Filled from recorded tasks only.
 */
export const WRAP_UP_HOUR = 17;

type T = {
  id: string;
  title: string;
  status: string;
  completed_at: string | null;
  deleted_at?: string | null;
  due_at: string | null;
  due_date: string | null;
  scheduling_mode?: string;
};

export function wrapUp<X extends T>(
  tasks: X[],
  now: Date,
  zone = "America/Vancouver",
) {
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const day = (iso: string) => formatInTimeZone(iso, zone, "yyyy-MM-dd");
  const live = tasks.filter((t) => !t.deleted_at);
  const done = live.filter(
    (t) => t.completed_at && day(t.completed_at) === today,
  );
  const open = live.filter((t) => {
    if (["completed", "cancelled"].includes(t.status)) return false;
    const due = t.due_at ? day(t.due_at) : t.due_date;
    return t.status === "in_progress" || (!!due && due <= today);
  });
  return {
    show: Number(formatInTimeZone(now, zone, "H")) >= WRAP_UP_HOUR,
    done,
    open: open.map((t) => ({
      task: t,
      overdue: (t.due_at ? day(t.due_at) : (t.due_date ?? today)) < today,
      /** Eligible work is placed again by the scheduler on its own. */
      autoRescheduled: t.scheduling_mode === "eligible",
    })),
  };
}
