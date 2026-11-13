"use client";
import Link from "next/link";
import { Clock3, ArrowRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useBriefing } from "./use-briefing";
export function WeeklyInsights() {
  const state = useBriefing();
  const d = state.data;
  if (!d)
    return (
      <p role={state.error ? "alert" : "status"}>
        {state.error || "Loading your weekly progress…"}
      </p>
    );
  return (
    <section className="panel briefing-card">
      <span className="eyebrow">THIS WEEK</span>
      <div className="panel-heading">
        <h2>Your week at a glance</h2>
        <Clock3 size={18} />
      </div>
      <p className="small muted">
        {d.weekly.start} · Updated{" "}
        {formatInTimeZone(d.refreshed_at, d.timezone, "MMM d, h:mm a")}
      </p>
      <ul className="briefing-reasons">
        <li>
          {d.weekly.completed_tasks} tasks completed;{" "}
          {d.weekly.completed_on_time} met their deadline,{" "}
          {d.weekly.completed_late} completed after it.
        </li>
        <li>
          {d.source_errors.includes("work")
            ? "Work history unavailable."
            : `${d.weekly.reported_minutes} minutes logged; ${d.weekly.planned_minutes} minutes planned.`}
        </li>
        <li>{d.weekly.deferrals} tasks put off this week.</li>
        <li>
          {d.source_errors.includes("study")
            ? "Study history unavailable."
            : `${d.weekly.reported_academic_minutes} study minutes logged.`}
        </li>
      </ul>
      {d.weekly.needs_review.length > 0 && (
        <p>
          Topics needing review:{" "}
          {d.weekly.needs_review.map((t) => t.title).join(", ")}
        </p>
      )}
      {d.weekly.goals.map((g) => (
        <p key={g.id}>
          <Link href={`/goals#goal-${g.id}`}>{g.title}</Link> · {g.progress}
        </p>
      ))}
      <details className="briefing-detail">
        <summary>Definitions and missing historical data</summary>
        <p className="small muted">
          {d.weekly.coverage} Historical conflict frequency and deadline-change
          counts are not inferred from a single current snapshot.
        </p>
      </details>
      <Link href="/reviews" className="text-link">
        Open your full weekly review <ArrowRight size={12} />
      </Link>
    </section>
  );
}
