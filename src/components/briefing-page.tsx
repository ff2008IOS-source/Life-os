"use client";
import Link from "next/link";
import { consumerReason } from "@/lib/consumer-copy";
import { useState, useRef } from "react";
import {
  Focus,
  CalendarDays,
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
          <span className="eyebrow">YOUR DAY, WITH A LITTLE PERSPECTIVE</span>
          <h1>Life OS Briefing</h1>
          <p>A clear head for the day ahead.</p>
        </div>
        <Link href="/assistant/history" className="text-link">
          Past conversations
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
  const nextAssessment = d?.assessments
    .filter((a) => {
      const day =
        a.due_date ??
        (a.due_at
          ? formatInTimeZone(a.due_at, d.timezone, "yyyy-MM-dd")
          : null);
      return (
        !a.dropped &&
        !["submitted", "returned", "excused"].includes(a.submission_state) &&
        day &&
        day >= d.today &&
        (!a.due_at || Date.parse(a.due_at) >= Date.parse(d.refreshed_at))
      );
    })
    .sort((a, b) =>
      (a.due_at ?? a.due_date ?? "").localeCompare(
        b.due_at ?? b.due_date ?? "",
      ),
    )[0];
  const assessmentHref = nextAssessment
    ? `/areas/academics?course=${nextAssessment.course_id}&assessment=${nextAssessment.id}#assessment-${nextAssessment.id}`
    : "/areas/academics";

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
        <p className="small muted">
          {consumerReason(r.reasons[0])}
          {r.remaining_minutes !== null
            ? ` · ${r.remaining_minutes} min ${task?.actual_minutes == null ? "estimated" : "remaining"}`
            : ""}
        </p>
        {index === 0 && (
          <details className="briefing-detail">
            <summary>Why this comes first</summary>
            <ul>
              {r.reasons.map((reason) => (
                <li key={reason}>{consumerReason(reason)}</li>
              ))}
            </ul>
          </details>
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
        <section
          className={
            compact ? "panel next-action focus-card" : "panel briefing-card"
          }
          aria-busy={c.loading}
        >
          <h2>{compact ? "Next best action" : "Daily Briefing"}</h2>
          <p>
            {c.loading
              ? "Getting your day ready…"
              : "Your briefing couldn’t load. You can still open your planner."}
          </p>
          {c.loading ? (
            <div className="focus-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <Button variant="outline" onClick={() => void c.reload()}>
              Try again
            </Button>
          )}
        </section>
      ) : compact ? (
        <section
          className="panel next-action focus-card"
          aria-labelledby="next-action-title"
        >
          <div className="panel-heading">
            <h2 id="next-action-title">Next best action</h2>
            <Link href="/briefing" className="text-link">
              Open your briefing <ArrowRight size={12} />
            </Link>
          </div>
          <div className="focus-art" aria-hidden="true">
            <Focus size={42} strokeWidth={1.2} />
          </div>
          {d.recommendations[0] ? (
            <>
              <h3>{d.recommendations[0].title}</h3>
              <p className="focus-description">
                {d.recommendations[0].urgency >= 3
                  ? "A close deadline makes this a good place to start."
                  : "A focused step toward what matters to you."}
              </p>
              <div className="focus-meta">
                {d.recommendations[0].remaining_minutes !== null && (
                  <span>
                    <Clock3 size={14} />
                    {d.recommendations[0].remaining_minutes} min{" "}
                    {w.tasks.find((t) => t.id === d.recommendations[0].task_id)
                      ?.actual_minutes == null
                      ? "estimated"
                      : "remaining"}
                  </span>
                )}
                <span>{consumerReason(d.recommendations[0].reasons[0])}</span>
              </div>
              <details className="focus-explanation">
                <summary>Why this comes first</summary>
                <ul>
                  {d.recommendations[0].reasons.map((reason) => (
                    <li key={reason}>{consumerReason(reason)}</li>
                  ))}
                </ul>
              </details>
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
          ) : nextAssessment ? (
            <div className="focus-academic">
              <span className="focus-overline">
                COMING UP IN {nextAssessment.course}
              </span>
              <h3>{nextAssessment.title}</h3>
              <p className="focus-description">
                Make a little room to prepare.
              </p>
              <div className="focus-meta">
                <span>
                  <CalendarDays size={14} />
                  {nextAssessment.verification_status === "unverified"
                    ? "Check the deadline"
                    : `Due ${nextAssessment.due_at ? formatInTimeZone(nextAssessment.due_at, d.timezone, "EEE, MMM d · h:mm a") : formatInTimeZone(nextAssessment.due_date + "T12:00:00Z", d.timezone, "EEE, MMM d")}`}
                </span>
              </div>
              <Button asChild>
                <Link href={assessmentHref}>
                  Plan preparation <ArrowRight size={15} />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="focus-empty">
              <h3>Your next move starts here.</h3>
              <p className="focus-description">
                Add one thing you want to make progress on, or take a look at
                your week.
              </p>
              <Button asChild>
                <Link href="/planner">
                  Plan your day <ArrowRight size={15} />
                </Link>
              </Button>
            </div>
          )}
          <div className="focus-footer">
            <span>
              {d.summary.commitments == null
                ? "Calendar needs an update"
                : `${d.summary.commitments} ${d.summary.commitments === 1 ? "commitment" : "commitments"} today`}
            </span>
            {d.attention.length > 0 && (
              <Link href="/briefing#needs-attention">
                {d.attention.length} to review <ArrowRight size={12} />
              </Link>
            )}
          </div>
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
                <span>tasks finished yesterday</span>
              </div>
            </div>
            <p className="briefing-refresh">
              Updated{" "}
              {formatInTimeZone(d.refreshed_at, d.timezone, "MMM d, h:mm a")} ·{" "}
              {d.timezone}.
            </p>
            <p className="small muted">
              {d.calendar.reliable
                ? `${d.calendar.available_minutes} minutes available for focused work.`
                : "Update your calendar to see your free time."}
            </p>
            <details className="briefing-detail">
              <summary>Schedule and connection details</summary>
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
                  No events to show; check your calendar connection before
                  treating the day as free.
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
                  <p>Choose something to work on in your planner.</p>
                )}
                {d.recommendations.length > 1 && (
                  <details className="briefing-detail">
                    <summary>Other options</summary>
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
                  <h2 id="needs-attention">Needs Attention</h2>
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
                  <h2>Your week at a glance</h2>
                  <Clock3 size={18} />
                </div>
                <p className="small muted">
                  {d.weekly.start} – {d.weekly.end_exclusive} (end exclusive),
                  as of refresh.
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
