"use client";
import Link from "next/link";
import { useState, useRef } from "react";
import {
  RefreshCw,
  ArrowRight,
  Sun,
  CheckCircle2,
  AlertCircle,
  Clock3,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useBriefing, type BriefingController } from "./use-briefing";
import { DailyCheckInPanel } from "./daily-check-in";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { TaskEditor, taskValues } from "./task-editor";
import { Modal } from "./dialog";
import { SchedulingPanel } from "./scheduling-panel";
import { calendarRequest } from "./use-calendar";
import type { Task } from "@/lib/schemas";

import type { Attention } from "@/lib/briefing";
export function BriefingPage() {
  const state = useBriefing();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            A CLEARER DAY, GROUNDED IN YOUR RECORDS
          </span>
          <h1>Life OS Briefing</h1>
          <p>What matters. What needs attention. Your next decision.</p>
        </div>
        <Link href="/assistant/history" className="text-link">
          Saved conversation archive
        </Link>
      </div>
      <BriefingPanel controller={state} />
    </>
  );
}
export function BriefingPanel({
  controller: c,
  compact = false,
}: {
  controller: BriefingController;
  compact?: boolean;
}) {
  const { data: w, mutate, notify } = useWorkspace();
  const d = c.data;
  const [editor, setEditor] = useState<Task | null>(null),
    [complete, setComplete] = useState<Task | null>(null),
    [scheduling, setScheduling] = useState<Task | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const actionIntent = useRef<{
    signature: string;
    id: string;
    until_at: string | null;
  } | null>(null);
  async function freshTask(id: string, mode: "edit" | "complete" | "schedule") {
    setBusy(true);
    setError("");
    try {
      const { data } = await calendarRequest<{ data: Task }>(
        `/api/v1/tasks/${id}`,
      );
      if (mode === "edit") setEditor(data);
      else if (mode === "complete") setComplete(data);
      else setScheduling(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Task could not be refreshed.");
    } finally {
      setBusy(false);
    }
  }

  async function act(input: {
    kind: "defer" | "snooze" | "dismiss";
    task_id?: string | null;
    item_key: string;
    fingerprint: string;
    until_at: string | null;
  }) {
    setBusy(true);
    setError("");
    try {
      const signature = JSON.stringify([
        input.kind,
        input.task_id ?? null,
        input.item_key,
        input.fingerprint,
      ]);
      if (actionIntent.current?.signature !== signature)
        actionIntent.current = {
          signature,
          id: crypto.randomUUID(),
          until_at: input.until_at,
        };
      await calendarRequest("/api/v1/briefing", {
        method: "POST",
        body: JSON.stringify({
          type: "action",
          task_id: null,
          ...input,
          id: actionIntent.current.id,
          until_at: actionIntent.current.until_at,
        }),
      });
      actionIntent.current = null;
      await c.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!d) return;
    setBusy(true);
    setSettingsError("");
    const f = new FormData(e.currentTarget);
    try {
      await calendarRequest("/api/v1/briefing", {
        method: "POST",
        body: JSON.stringify({
          type: "settings",
          version: d.settings_version,
          data: {
            fallback_name: String(f.get("fallback_name")),
            deadline_days: Number(f.get("deadline_days")),
            stalled_days: Number(f.get("stalled_days")),
            weights: Object.fromEntries(
              Object.keys(d.settings.weights).map((k) => [k, Number(f.get(k))]),
            ),
          },
        }),
      });
      await c.reload();
      notify("Briefing preferences saved");
    } catch (e) {
      setSettingsError(
        e instanceof Error ? e.message : "Preferences could not save.",
      );
    } finally {
      setBusy(false);
    }
  }
  const open = (id: string) => void freshTask(id, "edit");
  const actionCard = (index: number) => {
    const r = d?.recommendations[index];
    if (!r) return null;
    const task = w.tasks.find((t) => t.id === r.task_id);
    return (
      <article
        className={index === 0 ? "briefing-primary" : "briefing-alternative"}
        key={r.task_id}
      >
        <h3>{r.title}</h3>
        {index === 0 ? (
          <ul className="briefing-reasons">
            {r.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{r.reasons.slice(0, 2).join(" · ")}</p>
        )}
        {!!r.goals.length && (
          <div className="briefing-goal-links">
            {r.goals.map((g) => (
              <Link className="badge" href={`/goals#goal-${g.id}`} key={g.id}>
                {g.title}
              </Link>
            ))}
          </div>
        )}
        <div className="briefing-actions">
          <Button size="sm" onClick={() => open(r.task_id)}>
            View Task
          </Button>
          {task && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !!c.error}
                onClick={() => void freshTask(task.id, "complete")}
              >
                Mark Complete
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!c.error}
                onClick={() => void freshTask(task.id, "schedule")}
              >
                Schedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !!c.error}
                onClick={() =>
                  void act({
                    kind: "defer",
                    task_id: r.task_id,
                    item_key: `task:${r.task_id}`,
                    fingerprint: String(r.version),
                    until_at: new Date(Date.now() + 3600000).toISOString(),
                  })
                }
              >
                Not Now
              </Button>
            </>
          )}
        </div>
      </article>
    );
  };
  const dismiss = (
    a: Attention,
    kind: "snooze" | "dismiss",
    until: string | null,
  ) =>
    void act({
      kind,
      item_key: a.id,
      fingerprint: a.fingerprint,
      until_at: until,
    });
  return (
    <>
      {(c.error || error) && (
        <div className="notice" role="alert">
          <AlertCircle />
          <div>
            <strong>
              {c.error ? "Briefing refresh failed" : "Action unavailable"}
            </strong>
            <p>{c.error || error}</p>
            {d && c.error && (
              <p>
                Last successful refresh:{" "}
                {formatInTimeZone(d.refreshed_at, d.timezone, "MMM d, h:mm a")}.
                Recommendations may be stale.
              </p>
            )}
          </div>
        </div>
      )}
      {!d ? (
        <section className="panel briefing-card">
          <h2>{compact ? "Next best action" : "Daily Briefing"}</h2>
          <p>
            {c.loading
              ? "Preparing your recorded day…"
              : "Briefing data is unavailable. Your tasks remain in the planner."}
          </p>
          <Button
            variant="outline"
            onClick={() => void c.reload()}
            disabled={c.loading}
          >
            Retry briefing
          </Button>
        </section>
      ) : compact ? (
        <section
          className="panel next-action"
          aria-labelledby="next-action-title"
        >
          <div className="panel-heading">
            <h2 id="next-action-title">Next best action</h2>
            <Link href="/briefing" className="text-link">
              Open your briefing <ArrowRight size={12} />
            </Link>
          </div>
          <p className="small muted">
            {d.summary.commitments ?? "Unknown"} calendar commitments ·{" "}
            {d.summary.approaching_deadlines ?? "Unknown"} approaching academic
            deadlines · {d.attention.length} items to review
          </p>
          {d.recommendations[0] ? (
            <>
              <h3>{d.recommendations[0].title}</h3>
              <p className="panel-description">
                {d.recommendations[0].reasons.join(" · ")}
              </p>
              <div className="flex-between">
                <div>
                  {d.recommendations[0].goals.map((g) => (
                    <Link
                      className="badge"
                      href={`/goals#goal-${g.id}`}
                      key={g.id}
                    >
                      {g.title}
                    </Link>
                  ))}
                </div>
                <div className="briefing-actions">
                  <Button
                    size="sm"
                    onClick={() => open(d.recommendations[0].task_id)}
                  >
                    Open task <ArrowRight size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!c.error}
                    onClick={() =>
                      void freshTask(d.recommendations[0].task_id, "complete")
                    }
                  >
                    Mark Complete
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="panel-description">
              No actionable task is currently recorded. Review upcoming
              deadlines or capture a task in the planner.
            </p>
          )}
          <p className="briefing-refresh">
            Refreshed {formatInTimeZone(d.refreshed_at, d.timezone, "h:mm a")}
          </p>
        </section>
      ) : (
        <>
          <section className="briefing-hero panel briefing-card">
            <div className="panel-heading">
              <span className="briefing-kicker">
                <Sun size={17} /> Daily Briefing
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void c.reload()}
                disabled={c.loading}
              >
                <RefreshCw size={14} />
                {c.loading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
            <h2>{d.greeting}</h2>
            <p>Here’s what deserves your attention today.</p>
            <div className="briefing-metrics">
              <div>
                <strong>{d.summary.commitments ?? "—"}</strong>
                <span>calendar commitments today</span>
              </div>
              <div>
                <strong>{d.summary.academic_tasks}</strong>
                <span>unfinished academic tasks</span>
              </div>
              <div>
                <strong>{d.summary.approaching_deadlines ?? "—"}</strong>
                <span>
                  academic deadlines in {d.settings.deadline_days} days
                </span>
              </div>
              <div>
                <strong>{d.summary.completed_yesterday}</strong>
                <span>tasks recorded complete yesterday</span>
              </div>
            </div>
            <p className="briefing-refresh">
              Last successful data refresh:{" "}
              {formatInTimeZone(d.refreshed_at, d.timezone, "MMM d, h:mm a")} ·{" "}
              {d.timezone}. Cached source synchronization is separate.
            </p>
            <p className="small muted">
              {d.calendar.reliable
                ? `${d.calendar.available_minutes} minutes of recorded availability after breaks, protected time and daily scheduling capacity.`
                : "Availability is unknown until your selected calendars are current."}
            </p>
            <details className="briefing-detail">
              <summary>
                Today’s recorded commitments and source freshness
              </summary>
              <p className="small muted">
                Oldest selected calendar sync:{" "}
                {d.calendar.last_source_sync
                  ? formatInTimeZone(
                      d.calendar.last_source_sync,
                      d.timezone,
                      "MMM d, h:mm a",
                    )
                  : "Not recorded"}
                . Cached events may change externally.
              </p>
              {d.calendar.events.length ? (
                <ul>
                  {d.calendar.events.map((e) => (
                    <li key={e.id}>
                      {e.title} ·{" "}
                      {e.start_at
                        ? formatInTimeZone(e.start_at, d.timezone, "h:mm a")
                        : "All day"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No cached commitments are shown; consult connection health
                  before treating the day as free.
                </p>
              )}
            </details>
          </section>
          <div className="briefing-columns">
            <div className="stack">
              <section
                className="panel briefing-card"
                aria-labelledby="recommendation-title"
              >
                <div className="panel-heading">
                  <h2 id="recommendation-title">Recommended Next Action</h2>
                  <CheckCircle2 size={18} />
                </div>
                {actionCard(0) ?? (
                  <p>
                    No unblocked, non-deferred task is recorded. Review upcoming
                    deadlines or capture a responsibility.
                  </p>
                )}
                {d.recommendations.length > 1 && (
                  <details className="briefing-detail">
                    <summary>Alternatives and ranking explanation</summary>
                    {d.recommendations
                      .slice(1)
                      .map((_, i) => actionCard(i + 1))}
                  </details>
                )}
                <p className="small muted">
                  Deadline urgency comes first. Within each band, adjustable
                  weights combine importance, academic consequences, available
                  time, linked goals and explicit deferrals. Unknown effort
                  never becomes zero.
                </p>
              </section>
            </div>
            <div className="stack">
              <section className="panel briefing-card">
                <div className="panel-heading">
                  <h2>Needs Attention</h2>
                  <AlertCircle size={18} />
                </div>
                <p className="small muted">
                  Confirmed issues, possible issues and connection problems stay
                  distinct. Dismissals apply only to the same source state.
                </p>
                {d.attention.length ? (
                  <div className="briefing-alerts">
                    {d.attention.slice(0, 5).map((a) => (
                      <article key={a.id}>
                        <span
                          className={`badge ${a.kind === "confirmed" ? "red" : ""}`}
                        >
                          {a.kind === "confirmed"
                            ? "Confirmed issue"
                            : a.kind === "connection"
                              ? "Connection issue"
                              : "Possible issue"}
                        </span>
                        <h3>{a.title}</h3>
                        <p>{a.detail}</p>
                        <div className="briefing-actions">
                          <Link href={a.href} className="text-link">
                            Review source
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              dismiss(
                                a,
                                "snooze",
                                new Date(Date.now() + 86400000).toISOString(),
                              )
                            }
                          >
                            Snooze 1 day
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => dismiss(a, "dismiss", null)}
                          >
                            Dismiss this state
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>
                    No attention items in the successfully retrieved records.
                  </p>
                )}
                {d.attention.length > 5 && (
                  <details className="briefing-detail">
                    <summary>{d.attention.length - 5} more items</summary>
                    {d.attention.slice(5).map((a) => (
                      <p key={a.id}>
                        <Link href={a.href}>{a.title}</Link> · {a.detail}
                      </p>
                    ))}
                  </details>
                )}
              </section>
              <DailyCheckInPanel today={d.today} timezone={d.timezone} />
              <details className="panel briefing-card">
                <summary>Weekly Insights</summary>
                <div className="panel-heading">
                  <h2>This week’s recorded progress</h2>
                  <Clock3 size={18} />
                </div>
                <p className="small muted">
                  {d.weekly.start} – {d.weekly.end_exclusive} (end exclusive),
                  as of refresh.
                </p>
                <ul className="briefing-reasons">
                  <li>
                    {d.weekly.completed_tasks} tasks recorded complete;{" "}
                    {d.weekly.completed_on_time} met a recorded deadline,{" "}
                    {d.weekly.completed_late} completed after it.
                  </li>
                  <li>
                    {d.source_errors.includes("work")
                      ? "Work history unavailable."
                      : `${d.weekly.planned_minutes} recorded reservation minutes; ${d.weekly.reported_minutes} minutes of effort reported. These use different time anchors and are not a completion percentage.`}
                  </li>
                  <li>
                    {d.weekly.deferrals} explicit Not Now decisions this week.
                  </li>
                  <li>
                    {d.source_errors.includes("study")
                      ? "Study history unavailable."
                      : `${d.weekly.reported_academic_minutes} recorded study minutes. Exposure does not establish mastery.`}
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
                    <Link href={`/goals#goal-${g.id}`}>{g.title}</Link> ·{" "}
                    {g.progress}
                  </p>
                ))}
                <details className="briefing-detail">
                  <summary>Definitions and missing historical data</summary>
                  <p className="small muted">
                    {d.weekly.coverage} Historical conflict frequency and
                    deadline-change counts are not inferred from a single
                    current snapshot.
                  </p>
                </details>
                <Link href="/reviews" className="text-link">
                  Open your full weekly review <ArrowRight size={12} />
                </Link>
              </details>
            </div>
          </div>
          <details className="panel briefing-card">
            <summary className="text-link">
              Personalization and transparent ranking settings
            </summary>
            <form className="briefing-settings" onSubmit={saveSettings}>
              <label>
                Fallback greeting name
                <input
                  name="fallback_name"
                  defaultValue={d.settings.fallback_name}
                  maxLength={60}
                />
              </label>
              <div className="form-grid">
                <label>
                  Approaching deadline window (days)
                  <input
                    name="deadline_days"
                    type="number"
                    min={1}
                    max={14}
                    defaultValue={d.settings.deadline_days}
                  />
                </label>
                <label>
                  Project check window (days)
                  <input
                    name="stalled_days"
                    type="number"
                    min={7}
                    max={90}
                    defaultValue={d.settings.stalled_days}
                  />
                </label>
              </div>
              <p className="small muted">
                Weights 0–5 apply within a deadline urgency band. They never
                override unfinished dependencies or source certainty.
              </p>
              <div className="form-grid">
                {Object.entries(d.settings.weights).map(([key, value]) => (
                  <label key={key}>
                    {key}
                    <input
                      name={key}
                      type="number"
                      min={0}
                      max={5}
                      defaultValue={value}
                    />
                  </label>
                ))}
              </div>
              {settingsError && <p role="alert">{settingsError}</p>}
              <Button disabled={busy}>Save briefing preferences</Button>
              <Link href="/settings" className="text-link">
                Profile picture and display name
              </Link>
            </form>
          </details>
        </>
      )}
      {editor && (
        <TaskEditor
          task={editor}
          onClose={() => {
            setEditor(null);
            void c.reload();
          }}
        />
      )}
      {complete && (
        <Modal
          open
          onOpenChange={(o) => !o && setComplete(null)}
          title="Complete this task?"
          description="This records Life OS task completion. It does not submit work or change university records."
        >
          <p>{complete.title}</p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await mutate(
                  "tasks",
                  complete.id,
                  { ...taskValues(complete), status: "completed" },
                  complete.version,
                );
                setComplete(null);
                await c.reload();
                notify("Task completed");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Completion failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm task completion
          </Button>
        </Modal>
      )}
      {scheduling && (
        <Modal
          open
          onOpenChange={(o) => !o && setScheduling(null)}
          title="Schedule work"
          description="Existing planner previews and confirmation rules apply. Opening this window never writes a calendar event."
        >
          <p>{scheduling.title}</p>
          {scheduling.scheduling_mode === "eligible" ? (
            <SchedulingPanel />
          ) : (
            <>
              <p>Enable scheduling eligibility and check its estimate first.</p>
              <Button
                onClick={() => {
                  setEditor(scheduling);
                  setScheduling(null);
                }}
              >
                Edit scheduling eligibility
              </Button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
