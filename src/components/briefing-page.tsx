"use client";
import Link from "next/link";
import { useCurrentTime } from "./use-current-time";
import { useFocusSession } from "./focus-session-provider";
import { consumerReason } from "@/lib/consumer-copy";
import { useState, useRef, useEffect } from "react";
import { CalendarDays, ArrowRight, AlertCircle, Clock3 } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { type BriefingController } from "./use-briefing";
import { DailyCheckInPanel } from "./daily-check-in";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { TaskEditor, taskValues } from "./task-editor";
import { Modal } from "./dialog";
import { SchedulingPanel } from "./scheduling-panel";
import { calendarRequest } from "./use-calendar";
import type { Task } from "@/lib/schemas";

import type { Attention } from "@/lib/briefing";
function snoozeUntil(minutes: number) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}
export function BriefingPanel({
  controller: c,
  compact = false,
  hideConnectionAlerts = false,
}: {
  controller: BriefingController;
  compact?: boolean;
  hideConnectionAlerts?: boolean;
}) {
  const { data: w, mutate, notify } = useWorkspace();
  const focus = useFocusSession();
  const now = useCurrentTime();
  const d = c.data;
  const inlineActive = compact && !!d && !!focus?.session;
  const setInlineAvailable = focus?.setInlineAvailable;
  useEffect(() => {
    if (!compact) return;
    setInlineAvailable?.(inlineActive);
    return () => setInlineAvailable?.(false);
  }, [compact, inlineActive, setInlineAvailable]);
  const primary = d?.recommendations[0];
  const activeTask = focus?.session
    ? w.tasks.find((t) => t.id === focus.session?.task_id)
    : null;
  const nextCommitment = d?.calendar.reliable
    ? d.calendar.events
        .filter(
          (e) =>
            e.start_at && (!e.end_at || Date.parse(e.end_at) > now.getTime()),
        )
        .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!))[0]
    : null;
  const attention =
    d?.attention.filter(
      (a) => !hideConnectionAlerts || a.kind !== "connection",
    ) ?? [];
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
  async function deferPrimary() {
    const r = d?.recommendations[0];
    if (!r) return;
    const until = snoozeUntil(60);
    await act({
      kind: "defer",
      task_id: r.task_id,
      item_key: `task:${r.task_id}`,
      fingerprint: String(r.version),
      until_at: until,
    });
  }
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
  if (!compact && !d) return null;
  return (
    <>
      {((compact && c.error) || error) && (
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
          <h2>{compact ? "Focus" : "Day review"}</h2>
          <p>
            {c.loading
              ? "Loading…"
              : "Couldn’t refresh. Your planner is still available."}
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
          className="panel next-action focus-card briefing-primary"
          aria-labelledby="next-action-title"
        >
          <div className="panel-heading">
            <h2 id="next-action-title">Focus</h2>
            <Link href="/#needs-attention" className="text-link">
              Review your day <ArrowRight size={12} />
            </Link>
          </div>
          {focus?.session ? (
            <div data-current-focus tabIndex={-1}>
              <h3>
                <button
                  type="button"
                  className="focus-title"
                  onClick={() => focus.session && open(focus.session.task_id)}
                >
                  {w.tasks.find((t) => t.id === focus.session?.task_id)
                    ?.title ?? "Your current focus"}
                </button>
              </h3>
              <p className="focus-description">
                Focus ·{" "}
                {focus.session.status === "running" ? "In progress" : "Paused"}
              </p>
              {activeTask?.estimated_minutes != null && (
                <p className="focus-description">
                  About{" "}
                  {Math.max(
                    0,
                    activeTask.estimated_minutes -
                      (activeTask.actual_minutes ?? 0),
                  )}{" "}
                  min left, based on logged work.
                </p>
              )}
              <div className="focus-dock-actions">
                <Button
                  disabled={focus.busy}
                  onClick={() => void focus.toggle()}
                >
                  {focus.session.status === "running"
                    ? "Pause current focus"
                    : "Resume current focus"}
                </Button>
                <Button
                  variant="outline"
                  disabled={focus.busy}
                  onClick={focus.finish}
                >
                  Finish current focus
                </Button>
                <details className="focus-secondary">
                  <summary>More actions</summary>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={focus.busy}
                    onClick={() => void focus.discard()}
                  >
                    Discard timer
                  </Button>
                </details>
              </div>
            </div>
          ) : d.recommendations[0] ? (
            <>
              <h3>
                <button
                  className="focus-title"
                  onClick={() => open(d.recommendations[0].task_id)}
                >
                  {d.recommendations[0].title}
                </button>
              </h3>
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
                  {focus && primary && (
                    <div className="focus-start-action">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={
                          focus.busy ||
                          !focus.canStart ||
                          !!focus.session ||
                          !!w.tasks.find((t) => t.id === primary.task_id)
                            ?.recurrence_rule_id
                        }
                        onClick={() => void focus.start(primary.task_id)}
                      >
                        Start focus
                      </Button>
                    </div>
                  )}
                  <details className="focus-secondary">
                    <summary>More actions</summary>
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => open(d.recommendations[0].task_id)}
                      >
                        Open task <ArrowRight size={12} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !!c.error}
                        onClick={() =>
                          void freshTask(
                            d.recommendations[0].task_id,
                            "schedule",
                          )
                        }
                      >
                        Schedule
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !!c.error}
                        onClick={deferPrimary}
                      >
                        Not Now
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !!c.error}
                        onClick={() =>
                          void freshTask(
                            d.recommendations[0].task_id,
                            "complete",
                          )
                        }
                      >
                        Mark Complete
                      </Button>
                    </div>
                  </details>
                </div>
              </div>
            </>
          ) : nextAssessment ? (
            <div className="focus-academic">
              <span className="focus-overline">
                COMING UP IN {nextAssessment.course}
              </span>
              <h3>{nextAssessment.title}</h3>
              <p className="focus-description"></p>
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
              <h3>Nothing queued.</h3>
              <p className="focus-description">Add a task or open Planner.</p>
              <Button asChild>
                <Link href="/planner">
                  Plan your day <ArrowRight size={15} />
                </Link>
              </Button>
            </div>
          )}
          {nextCommitment && (
            <p className="focus-calendar-context">
              <Link href="/planner?section=calendar">
                {Date.parse(nextCommitment.start_at!) <= now.getTime()
                  ? "On your calendar now"
                  : "Next commitment"}
                : {nextCommitment.title} ·{" "}
                {formatInTimeZone(
                  nextCommitment.start_at!,
                  d.timezone,
                  "h:mm a",
                )}
              </Link>
            </p>
          )}
          {d.weekly.calendar_reliable && d.weekly.conflict_count > 0 && (
            <p className="focus-calendar-context">
              <Link href="/planner?section=calendar">
                {d.weekly.conflict_count} overlapping commitments this week ·
                Review planner
              </Link>
            </p>
          )}
        </section>
      ) : (
        <>
          <div className="briefing-columns home-attention-grid">
            <div className="stack">
              <section className="panel briefing-card">
                <div className="panel-heading">
                  <h2 id="needs-attention">Needs attention</h2>
                  <AlertCircle size={18} />
                </div>
                <p className="small muted">
                  A few things worth checking before they get in your way.
                </p>
                {attention.length ? (
                  <div className="briefing-alerts">
                    {attention.slice(0, 5).map((a) => (
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
                            Take a look
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              dismiss(a, "snooze", snoozeUntil(1440))
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
                            Dismiss
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>Nothing needs attention in your latest update.</p>
                )}
                {attention.length > 5 && (
                  <details className="briefing-detail">
                    <summary>{attention.length - 5} more items</summary>
                    {attention.slice(5).map((a) => (
                      <p key={a.id}>
                        <Link href={a.href}>{a.title}</Link> · {a.detail}
                      </p>
                    ))}
                  </details>
                )}
              </section>
              <DailyCheckInPanel today={d.today} timezone={d.timezone} />
            </div>
          </div>
          <details className="panel briefing-card">
            <summary className="text-link">
              Adjust your daily priorities
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
                Your preferences
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
