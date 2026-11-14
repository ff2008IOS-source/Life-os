"use client";
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
  const end = localDate();
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
      t.completed_at &&
      localDate(t.completed_at) >= start &&
      localDate(t.completed_at) <= end,
  );
  const recurringCompletions = data.occurrences.filter(
    (o) =>
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
  const days = Array.from({ length: 7 }, (_, i) =>
    format(addDays(new Date(end + "T12:00:00"), i - 6), "yyyy-MM-dd"),
  );
  const bars = days.map((day) => ({
    day,
    count: completed.filter((t) => localDate(t.completed_at!) === day).length,
  }));
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROGRESS, WITH PERSPECTIVE</span>
          <h1>Your insights</h1>
          <p>Useful patterns from what you actually record.</p>
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
      <WorkSessionsPanel
        compact
        start={start}
        end={format(addDays(new Date(end + "T12:00:00"), 1), "yyyy-MM-dd")}
      />
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
        ].map((s) => (
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
            <h2>Daily task completions</h2>
            <span className="badge">Last 7 days</span>
          </div>
          <div className="panel-body">
            {completed.length ? (
              <>
                <div
                  className="insight-bars"
                  role="img"
                  aria-label={`Daily completed tasks: ${bars.map((b) => `${b.day}: ${b.count}`).join(", ")}`}
                >
                  {bars.map((b) => (
                    <div className="bar-column" key={b.day}>
                      <span>{b.count}</span>
                      <div
                        className="bar"
                        style={{ height: `${(b.count / max) * 105}px` }}
                      />
                      <small>
                        {format(new Date(b.day + "T12:00:00"), "EEE")}
                      </small>
                    </div>
                  ))}
                </div>
                <details style={{ marginTop: 15 }}>
                  <summary className="text-link">View chart data</summary>
                  <table>
                    <caption className="sr-only">
                      Daily task completions in Vancouver
                    </caption>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bars.map((b) => (
                        <tr key={b.day}>
                          <td>{b.day}</td>
                          <td>{b.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
              Source: user-entered task completion timestamps · last 7 days ·
              America/Vancouver. Based on what you’ve logged in Life OS.
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
                  {data.areas.map((a) => (
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
      <div className="notice" style={{ marginTop: 22 }}>
        <ChartNoAxesCombined />
        <div>
          <strong>Missing data stays missing</strong>
          <p>
            Academic performance, spending, habits, and calendar utilization
            will appear only when relevant records are available. No estimates
            are being substituted.
          </p>
        </div>
      </div>
    </>
  );
}
