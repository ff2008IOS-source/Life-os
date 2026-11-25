import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * "Can I fit this week?" Estimated work due in the next seven days against
 * the time actually free to schedule it: inside the saved window, around
 * busy calendar events, capped at the daily limit. Deterministic; work with
 * no time estimate is counted separately, never guessed.
 */
export type FitEvent = {
  start_at: string | null;
  end_at: string | null;
  all_day_start: string | null;
  busy_status?: string | null;
};
export type FitTask = {
  title: string;
  status: string;
  deleted_at?: string | null;
  due_at: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
  actual_minutes?: number | null;
};
export type FitPolicy = {
  start_hour: number;
  end_hour: number;
  max_daily_minutes: number;
};

const MIN = 60000;

export function weekFit(input: {
  now: Date;
  zone?: string;
  policy: FitPolicy;
  events: FitEvent[];
  tasks: FitTask[];
  days?: number;
}) {
  const zone = input.zone ?? "America/Vancouver";
  const days = input.days ?? 7;
  const today = formatInTimeZone(input.now, zone, "yyyy-MM-dd");
  const dateAt = (offset: number) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const end = dateAt(days - 1);
  const busy = input.events
    .filter(
      (e) =>
        e.start_at && e.end_at && !e.all_day_start && e.busy_status !== "free",
    )
    .map((e) => [Date.parse(e.start_at!), Date.parse(e.end_at!)] as const);

  const perDay: { date: string; free: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = dateAt(i);
    let from = fromZonedTime(
      `${date}T${String(input.policy.start_hour).padStart(2, "0")}:00:00`,
      zone,
    ).getTime();
    const to = fromZonedTime(
      `${date}T${String(input.policy.end_hour).padStart(2, "0")}:00:00`,
      zone,
    ).getTime();
    if (i === 0) from = Math.max(from, input.now.getTime());
    let free = 0;
    if (to > from) {
      // Merge busy time inside the window, then subtract it.
      const spans = busy
        .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as const)
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
      let cursor = from;
      for (const [s, e] of spans) {
        if (s > cursor) free += s - cursor;
        cursor = Math.max(cursor, e);
      }
      if (to > cursor) free += to - cursor;
    }
    perDay.push({
      date,
      free: Math.min(Math.round(free / MIN), input.policy.max_daily_minutes),
    });
  }

  const dueDay = (t: FitTask) =>
    t.due_at ? formatInTimeZone(t.due_at, zone, "yyyy-MM-dd") : t.due_date;
  const due = input.tasks.filter((t) => {
    if (t.deleted_at || ["completed", "cancelled"].includes(t.status))
      return false;
    const d = dueDay(t);
    return !!d && d <= end; // overdue work still needs time this week
  });
  const estimated = due.filter((t) => (t.estimated_minutes ?? 0) > 0);
  const need = estimated.reduce(
    (n, t) => n + Math.max(0, t.estimated_minutes! - (t.actual_minutes ?? 0)),
    0,
  );
  const free = perDay.reduce((n, d) => n + d.free, 0);
  return {
    needMinutes: need,
    freeMinutes: free,
    unestimated: due
      .filter((t) => !((t.estimated_minutes ?? 0) > 0))
      .map((t) => t.title),
    tasks: due.length,
    fits: need <= free,
    shortMinutes: Math.max(0, need - free),
    perDay,
  };
}

export const hours = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`;
