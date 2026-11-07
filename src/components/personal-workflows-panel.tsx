"use client";
import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import { formatInTimeZone } from "date-fns-tz";
import type { WorkflowSetting } from "@/lib/personal-workflows";
type Item = {
  id: string;
  title?: string;
  name?: string;
  code?: string;
  due_at?: string;
  due_date?: string;
  completion_evidence?: string;
  deadline_passed?: boolean;
  verification_status?: string;
};
type Run = {
  id: string;
  workflow_type: WorkflowSetting["workflow_type"];
  generated_at: string;
  scheduled_for: string | null;
  snapshot: {
    week_start: string;
    week_end_exclusive: string;
    as_of: string;
    rule: string;
    assessments?: Item[];
    unknown_deadlines?: number;
    completed_tasks?: Item[];
    missed_tasks?: Item[];
    milestones?: Item[];
    upcoming_tasks?: Item[];
    networking_followups?: Item[];
    active_projects?: Item[];
    active_goals?: Item[];
    academic_needs_review?: number;
    work?: {
      sessions: number;
      actual_minutes: number;
      academic_minutes: number;
    };
  };
};
type State = { settings: WorkflowSetting[]; runs: Run[]; has_more: boolean };
const names = {
  daily_check: "Daily Missed Task Check",
  career_debrief: "Weekly Career Debrief",
};
export function PersonalWorkflowsPanel() {
  const [page, setPage] = useState(0);
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const intent = useRef<{
    type: WorkflowSetting["workflow_type"];
    id: string;
  } | null>(null);
  const reload = async (historyPage = page) =>
    setState(
      await calendarRequest<State>(`/api/v1/workflows?page=${historyPage}`),
    );
  useEffect(() => {
    let live = true;
    void calendarRequest<State>(`/api/v1/workflows?page=${page}`)
      .then((d) => {
        if (live) setState(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [page]);
  return (
    <section className="panel settings-panel">
      <h2>Personal check-ins</h2>
      <p className="small muted">
        Prepare a saved check from actual academic records, tasks, goals and
        recorded effort. No new commitments are created automatically.
      </p>
      {(Object.keys(names) as WorkflowSetting["workflow_type"][]).map(
        (type) => (
          <div className="setting-line" key={type}>
            <div>
              <strong>{names[type]}</strong>
              <details>
                <summary className="text-link">
                  Schedule and notifications
                </summary>
                <form
                  key={JSON.stringify(
                    state?.settings.find((s) => s.workflow_type === type),
                  )}
                  className="academic-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    setBusy(true);
                    setError("");
                    try {
                      await calendarRequest("/api/v1/workflows", {
                        method: "PATCH",
                        body: JSON.stringify({
                          workflow_type: type,
                          enabled: f.has("enabled"),
                          run_time: f.get("run_time"),
                          weekday: Number(f.get("weekday") ?? 7),
                        }),
                      });
                      await reload();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={
                        state?.settings.find((s) => s.workflow_type === type)
                          ?.enabled ?? false
                      }
                    />
                    Enable this native workflow
                  </label>
                  <label>
                    Run time (Vancouver)
                    <input
                      type="time"
                      name="run_time"
                      required
                      defaultValue={
                        state?.settings
                          .find((s) => s.workflow_type === type)
                          ?.run_time?.slice(0, 5) ?? "20:00"
                      }
                    />
                  </label>
                  {type === "career_debrief" ? (
                    <label>
                      Review day
                      <select
                        name="weekday"
                        defaultValue={
                          state?.settings.find((s) => s.workflow_type === type)
                            ?.weekday ?? 7
                        }
                      >
                        {[
                          "Monday",
                          "Tuesday",
                          "Wednesday",
                          "Thursday",
                          "Friday",
                          "Saturday",
                          "Sunday",
                        ].map((d, i) => (
                          <option key={d} value={i + 1}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <input type="hidden" name="weekday" value="7" />
                  )}
                  <p className="form-hint">
                    Automatic runs start after production release. The latest
                    missed execution can run after recovery, with its actual
                    generation time preserved. Existing ChatGPT routines remain
                    unchanged.
                  </p>
                  <Button disabled={busy || !state}>
                    Save workflow schedule
                  </Button>
                </form>
              </details>
            </div>
            <Button
              size="sm"
              aria-label={`Prepare ${names[type]}`}
              disabled={busy || !state}
              onClick={async () => {
                setBusy(true);
                setError("");
                if (intent.current?.type !== type)
                  intent.current = { type, id: crypto.randomUUID() };
                try {
                  await calendarRequest("/api/v1/workflows", {
                    method: "POST",
                    body: JSON.stringify({
                      type,
                      request_id: intent.current.id,
                    }),
                  });
                  intent.current = null;
                  setPage(0);
                  await reload(0);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Prepare check
            </Button>
          </div>
        ),
      )}
      {state?.runs.map((run) => (
        <details key={run.id}>
          <summary
            className="text-link"
            style={{ minHeight: 44, paddingBlock: 8 }}
          >
            {names[run.workflow_type]} ·{" "}
            {formatInTimeZone(
              run.generated_at,
              "America/Vancouver",
              "MMM d, h:mm a",
            )}
          </summary>
          <p className="form-hint">
            Snapshot generated from records available at this time. Week{" "}
            {run.snapshot.week_start} through {run.snapshot.week_end_exclusive}{" "}
            (end exclusive).{" "}
            {run.scheduled_for
              ? `Scheduled for ${formatInTimeZone(run.scheduled_for, "America/Vancouver", "MMM d, h:mm a")}.`
              : "Prepared manually."}
          </p>
          {run.workflow_type === "daily_check" ? (
            <>
              <p className="small">
                {run.snapshot.unknown_deadlines ?? 0} assessments have unknown
                deadlines.
              </p>
              <ItemList
                label="Academic responsibilities"
                items={run.snapshot.assessments ?? []}
              />
            </>
          ) : (
            <>
              <p className="small">
                {run.snapshot.work?.actual_minutes ?? 0} reported work minutes ·{" "}
                {run.snapshot.work?.sessions ?? 0} completed sessions ·{" "}
                {run.snapshot.academic_needs_review ?? 0} topics marked for
                review.
              </p>
              <ItemList
                label="Completed tasks"
                items={run.snapshot.completed_tasks ?? []}
              />
              <ItemList
                label="Missed commitments"
                items={run.snapshot.missed_tasks ?? []}
              />
              <ItemList
                label="Upcoming tasks"
                items={run.snapshot.upcoming_tasks ?? []}
              />
              <ItemList
                label="Networking follow-ups"
                items={run.snapshot.networking_followups ?? []}
              />
              <ItemList
                label="Completed milestones"
                items={run.snapshot.milestones ?? []}
              />
              <ItemList
                label="Active projects"
                items={run.snapshot.active_projects ?? []}
              />
              <ItemList
                label="Active goals"
                items={run.snapshot.active_goals ?? []}
              />
            </>
          )}
          <p className="form-hint">{run.snapshot.rule}</p>
        </details>
      ))}
      <div className="career-import-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={!page || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Newer checks
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!state?.has_more || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          Older checks
        </Button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
function ItemList({ label, items }: { label: string; items: Item[] }) {
  return (
    <details>
      <summary className="text-link" style={{ minHeight: 44, paddingBlock: 8 }}>
        {label} ({items.length})
      </summary>
      {items.length ? (
        items.map((item) => (
          <div key={item.id} className="setting-line">
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong>
                {item.code ? `${item.code} · ` : ""}
                {item.title ?? item.name}
              </strong>
              {item.completion_evidence && (
                <p>
                  {item.completion_evidence.replaceAll("_", " ")}
                  {item.deadline_passed ? " · Past deadline" : ""}
                  {item.verification_status !== "verified"
                    ? " · Source needs verification"
                    : ""}
                </p>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="small muted">No matching records in this snapshot.</p>
      )}
    </details>
  );
}
