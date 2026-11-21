"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useBriefing } from "./use-briefing";
export function WeeklyInsights() {
  const state = useBriefing();
  const d = state.data;
  if (!d)
    return (
      <p role={state.error ? "alert" : "status"}>
        {state.error || "Loading weekly activity…"}
      </p>
    );
  const goalEvidence = d.weekly.goals.filter(
    (g) => !/reflection/i.test(g.progress),
  );
  const courses = [...new Set(d.weekly.needs_review.map((t) => t.course_id))];
  return (
    <section className="panel briefing-card weekly-insights">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">THIS WEEK</span>
          <h2>This week</h2>
        </div>
        <span className="small muted">
          Updated{" "}
          {formatInTimeZone(d.refreshed_at, d.timezone, "MMM d, h:mm a")}
        </span>
      </div>
      <div className="insight-highlights">
        <div>
          <strong>{d.weekly.completed_tasks || "—"}</strong>
          <span>
            {d.weekly.completed_tasks
              ? "tasks completed"
              : "No completed tasks"}
          </span>
          {d.weekly.completed_tasks > 0 && (
            <small>
              {d.weekly.completed_on_time} by their deadline
              {d.weekly.completed_late
                ? ` · ${d.weekly.completed_late} after it`
                : ""}
            </small>
          )}
        </div>
        <div>
          <strong>{d.weekly.milestones.length || "—"}</strong>
          <span>
            {d.weekly.milestones.length
              ? "milestones reached"
              : "No new milestones"}
          </span>
        </div>
        {d.weekly.deferrals > 0 && (
          <div>
            <strong>{d.weekly.deferrals}</strong>
            <span>tasks deferred</span>
            <small>Review what keeps getting pushed back</small>
          </div>
        )}
      </div>
      {d.weekly.milestones.length > 0 && (
        <ul className="insight-list">
          {d.weekly.milestones.slice(0, 4).map((m) => (
            <li key={m.id}>{m.title}</li>
          ))}
        </ul>
      )}
      {courses.length > 0 && (
        <section className="insight-section">
          <h3>Topics to review</h3>
          {courses.map((course) => (
            <details className="briefing-detail" key={course}>
              <summary>
                {d.assessments.find((a) => a.course_id === course)?.course ??
                  "Course practice"}{" "}
                ·{" "}
                {
                  d.weekly.needs_review.filter((t) => t.course_id === course)
                    .length
                }{" "}
                topics
              </summary>
              <ul className="insight-list">
                {d.weekly.needs_review
                  .filter((t) => t.course_id === course)
                  .map((t) => (
                    <li key={t.title}>
                      <Link
                        href={`/areas/academics?course=${course}&view=study`}
                      >
                        {t.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            </details>
          ))}
        </section>
      )}
      {goalEvidence.length > 0 && (
        <details className="briefing-detail">
          <summary>Current goal progress ({goalEvidence.length})</summary>
          <ul className="insight-list">
            {goalEvidence.map((g) => (
              <li key={g.id}>
                <Link href={`/goals#goal-${g.id}`}>{g.title}</Link>
                <span className="small muted">{g.progress}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Current status; this is not a measured change over the week.
          </p>
        </details>
      )}
      <details className="briefing-detail">
        <summary>About this summary</summary>
        <p className="small muted">{d.weekly.coverage}</p>
      </details>
      <Link href="/reviews" className="text-link">
        Open review <ArrowRight size={12} />
      </Link>
    </section>
  );
}
