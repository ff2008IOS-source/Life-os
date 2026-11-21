"use client";
import { activityTrend, progressActions } from "@/lib/activity-trends";
import { useCurrentTime } from "./use-current-time";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { AcademicProgressSummary } from "./academic-progress-summary";
import { visibleArea } from "@/lib/visible-areas";
import { WeeklyInsights } from "./weekly-insights";
import { realWorkspace } from "@/lib/real-workspace";
import { WorkSessionsPanel } from "./work-sessions-panel";
import { useState } from "react";
import { addDays, format } from "date-fns";
import { ChartNoAxesCombined, CheckCheck, Clock3, Flag } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { EmptyState } from "./task-list";
import { localDate, isOverdue } from "@/lib/dates";
export function InsightsPage() {
  const { data: raw } = useWorkspace();
  const data = realWorkspace(raw);
  const [range, setRange] = useState("week");
  const now = useCurrentTime();
  const zone = data.profile.timezone;
  const end = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const start = format(
    addDays(
      new Date(end + "T12:00:00"),
      range === "week"
        ? -6
        : range === "month"
          ? -29
          : range === "semester"
            ? -119
            : -364,
    ),
    "yyyy-MM-dd",
  );
  const completed = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      !t.recurrence_rule_id &&
      t.status === "completed" &&
      t.completed_at &&
      localDate(t.completed_at) >= start &&
      localDate(t.completed_at) <= end,
  );
  const recurringCompletions = data.occurrences.filter(
    (o) =>
      o.status === "completed" &&
      o.completed_at &&
      localDate(o.completed_at) >= start &&
      localDate(o.completed_at) <= end,
  );
  const recorded = data.tasks.filter((t) => !t.deleted_at);
  const overdue = recorded.filter((t) => isOverdue(t));
  const milestones = data.milestones.filter(
    (m) =>
      m.completed_at &&
      localDate(m.completed_at) >= start &&
      localDate(m.completed_at) <= end,
  );
  const trend = activityTrend(data, start, end, zone);
  const nextActions = progressActions(data, now, zone);
  const bars = trend.buckets.map((b) => ({ ...b, day: b.start }));
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROGRESS, WITH PERSPECTIVE</span>
          <h1>Insights</h1>
        </div>
        <select
          style={{ width: 130, fontSize: 11, minHeight: 35 }}
          aria-label="Insight timeframe"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="semester">Last 120 days</option>
          <option value="year">Last 365 days</option>
        </select>
      </div>
      {nextActions.length > 0 && (
        <section className="panel insight-next-actions">
          <div className="panel-heading">
            <h2>Useful next steps</h2>
          </div>
          {nextActions.map((action) => (
            <Link
              className="insight-next-action"
              key={action.title}
              href={action.href}
            >
              <strong>{action.title}</strong>
              <p>{action.detail}</p>
            </Link>
          ))}
          <p className="small muted">
            Based on current deadlines, milestone dates and task links—not a
            productivity score.
          </p>
        </section>
      )}
      <WorkSessionsPanel
        compact
        start={start}
        end={format(addDays(new Date(end + "T12:00:00"), 1), "yyyy-MM-dd")}
      />
      <AcademicProgressSummary />
      <WeeklyInsights />
      <div className="stats-grid">
        {[
          {
            label: "Tasks completed",
            value: completed.length,
            note: "Within selected range",
            icon: CheckCheck,
          },
          {
            label: "Overdue now",
            value: overdue.length,
            note: "Current snapshot, all dates",
            icon: Clock3,
          },
          {
            label: "Milestones completed",
            value: milestones.length,
            note: "Within selected range",
            icon: Flag,
          },
          {
            label: "Recurring completions",
            value: recurringCompletions.length,
            note: "Occurrences within selected range",
            icon: ChartNoAxesCombined,
          },
        ]
          .filter((s) => s.value > 0)
          .map((s) => (
            <section className="stat-card" key={s.label}>
              <div className="stat-label">
                {s.label}
                <s.icon />
              </div>
              <strong className="stat-number">{s.value}</strong>
              <span className="stat-note">{s.note}</span>
            </section>
          ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Recorded completion trend</h2>
            <span className="badge">
              {start}–{end}
            </span>
          </div>
          <div className="panel-body">
            {trend.total > 0 ? (
              <>
                <div
                  className={`insight-bars ${bars.length > 7 ? "insight-bars-dense" : ""}`}
                  role="img"
                  aria-label={`Completed tasks and recurring occurrences: ${bars.map((b) => `${b.day}: ${b.count}`).join(", ")}`}
                >
                  {bars.map((b, i) => (
                    <div className="bar-column" key={b.day}>
                      <span>{b.count}</span>
                      <div
                        className="bar"
                        style={{ height: `${(b.count / max) * 105}px` }}
                      />
                      <small>
                        {i % Math.ceil(bars.length / 7) === 0
                          ? format(
                              new Date(b.day + "T12:00:00"),
                              trend.bucketDays === 1 ? "EEE" : "MMM d",
                            )
                          : " "}
                      </small>
                    </div>
                  ))}
                </div>
                <details style={{ marginTop: 15 }}>
                  <summary className="text-link">View chart data</summary>
                  <div
                    className="table-wrap"
                    role="region"
                    aria-label="Completion trend data"
                    tabIndex={0}
                  >
                    {" "}
                    <table>
                      <caption className="sr-only">
                        Recorded task and occurrence completions in {zone}
                      </caption>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Completed</th>
                          <th>Tasks</th>
                          <th>Recurring occurrences</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bars.map((b) => (
                          <tr key={b.day}>
                            <td>
                              {b.start}
                              {b.end !== b.start ? `–${b.end}` : ""}
                            </td>
                            <td>{b.count}</td>
                            <td>{b.tasks}</td>
                            <td>{b.occurrences}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <EmptyState
                compact
                icon={ChartNoAxesCombined}
                title="A pattern will emerge over time"
                description="Finish a task to see your progress here."
              />
            )}
            <p className="data-source">
              Source: task and recurring-occurrence completion timestamps ·{" "}
              {start}–{end} · {zone}. Each completed record counts once. Missing
              history is not evidence that no work happened. Timer totals are
              shown separately as owner-confirmed actual minutes.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Work across your life areas</h2>
          </div>
          <div className="panel-body">
            {data.areas.length ? (
              <table>
                <caption className="sr-only">
                  Your tasks across life areas
                </caption>
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Active now</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.areas.filter(visibleArea).map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>
                        {
                          recorded.filter(
                            (t) =>
                              t.area_id === a.id &&
                              !["completed", "cancelled"].includes(t.status),
                          ).length
                        }
                      </td>
                      <td>
                        {completed.filter((t) => t.area_id === a.id).length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                compact
                title="No areas initialized"
                description="Set up your workspace to see recorded task distribution."
              />
            )}
            <p className="data-source">
              Source: user-entered tasks · completions {start}–{end}; active
              tasks are a current snapshot. Counts are not hours or productivity
              scores.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
