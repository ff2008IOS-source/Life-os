"use client";
import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { calendarRequest } from "./use-calendar";
import {
  hours,
  weekFit,
  type FitEvent,
  type FitPolicy,
  type FitTask,
} from "@/lib/week-fit";

/** "Can I fit this week?" — estimated work due vs time free to schedule it. */
export function WeekFitLine({
  now,
  policy,
  tasks,
}: {
  now: Date;
  policy: FitPolicy;
  tasks: FitTask[];
}) {
  const [events, setEvents] = useState<FitEvent[] | null>(null);
  const start = formatInTimeZone(now, "America/Vancouver", "yyyy-MM-dd");
  useEffect(() => {
    let live = true;
    const end = new Date(start + "T12:00:00Z");
    end.setUTCDate(end.getUTCDate() + 7);
    calendarRequest<{ events: FitEvent[] }>(
      `/api/v1/calendar/events?start=${start}&end=${end.toISOString().slice(0, 10)}`,
    )
      .then((r) => live && setEvents(r.events))
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, [start]);
  if (!events) return null;
  const fit = weekFit({ now, policy, events, tasks });
  if (!fit.tasks) return null;
  return (
    <div className="td-stat td-fit" aria-label="Can I fit this week">
      <div>
        <span>Work due in the next 7 days</span>
        <span className={fit.fits ? "td-ok" : "td-hot"}>
          {fit.needMinutes ? hours(fit.needMinutes) : "—"} of{" "}
          {hours(fit.freeMinutes)} free
        </span>
      </div>
      <p className="td-muted td-small">
        {fit.needMinutes === 0
          ? "None of it has a time estimate yet."
          : fit.fits
            ? "Fits in your free scheduling time."
            : `About ${hours(fit.shortMinutes)} more than your free time. Move something or ask for help early.`}
        {fit.needMinutes > 0 && fit.unestimated.length
          ? ` ${fit.unestimated.length} more ${fit.unestimated.length === 1 ? "item has" : "items have"} no estimate.`
          : ""}
      </p>
    </div>
  );
}
