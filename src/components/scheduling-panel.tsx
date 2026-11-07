"use client";
import { ManagedCalendarPanel } from "./managed-calendar-panel";
import { useState } from "react";
import { Play, ShieldCheck, Clock3, TriangleAlert } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import {
  DEFAULT_POLICY,
  blockLocalLabel,
  type ScheduleResult,
} from "@/lib/scheduler";
import { AutomationControl } from "./automation-control";
import { ReservationsPanel } from "./reservations-panel";
import { EmptyState } from "./task-list";
export function SchedulingPanel() {
  const { data, request, refresh } = useWorkspace();
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  async function preview() {
    setPending(true);
    setError("");
    setResult(null);
    try {
      setResult(
        (await request("/api/v1/schedule/preview", {
          method: "POST",
          body: JSON.stringify({ policy }),
        })) as ScheduleResult,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <div className="notice">
        <ShieldCheck />
        <div>
          <strong>Plan around your connected calendars</strong>
          <p>
            Selected calendars are refreshed before planning when more than five
            minutes old. Automation uses the same scheduling boundaries as
            previews.
          </p>
        </div>
      </div>
      <AutomationControl policy={policy} />
      <ManagedCalendarPanel />
      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">
            <Clock3 />
            <h2>Your scheduling boundaries</h2>
          </div>
          <span className="badge">America/Vancouver</span>
        </div>
        <div className="policy-grid">
          {[
            { label: "Window", value: "9 AM – 9 PM" },
            {
              label: "Daily maximum",
              value: `${policy.max_daily_minutes} min`,
            },
            {
              label: "Session length",
              value: `${policy.min_session_minutes}–${policy.max_session_minutes} min`,
            },
            { label: "Between sessions", value: `${policy.break_minutes} min` },
            { label: "Freeze window", value: `${policy.freeze_minutes} min` },
            {
              label: "Horizon",
              value: `${policy.scheduling_horizon_days} days`,
            },
          ].map((i) => (
            <div className="policy-item" key={i.label}>
              {i.label}
              <strong>{i.value}</strong>
            </div>
          ))}
        </div>
        <details className="panel-body">
          <summary className="text-link">Adjust planning boundaries</summary>
          <div className="form-grid" style={{ marginTop: 16 }}>
            <label>
              Daily cap (minutes)
              <input
                type="number"
                min="25"
                max="240"
                value={policy.max_daily_minutes}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    max_daily_minutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Horizon (days)
              <input
                type="number"
                min="1"
                max="7"
                value={policy.scheduling_horizon_days}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    scheduling_horizon_days: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Minimum session
              <input
                type="number"
                min="25"
                max="90"
                value={policy.min_session_minutes}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    min_session_minutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Maximum session
              <input
                type="number"
                min="25"
                max="90"
                value={policy.max_session_minutes}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    max_session_minutes: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        </details>
        <div className="panel-footer flex-between">
          <span>Eligible areas: Academics, Career, Projects</span>
          <Button onClick={preview} disabled={pending}>
            <Play size={13} />
            {pending ? "Planning…" : "Generate preview"}
          </Button>
        </div>
      </section>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <ReservationsPanel
        runId={result?.run_id}
        onApplied={() => {
          setResult(null);
          void refresh();
        }}
      />
      {result && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Proposed sessions</h2>
            <span className="badge blue">
              {result.blocks.length} blocks · Not saved
            </span>
          </div>
          {result.blocks.map((b, i) => (
            <div className="schedule-item" key={`${b.task_id}-${i}`}>
              <span className="time">{b.minutes} min</span>
              <div>
                <strong>
                  {data.tasks.find((t) => t.id === b.task_id)?.title}
                </strong>
                <p>{blockLocalLabel(b)}</p>
                <p>{b.reason}</p>
              </div>
            </div>
          ))}
          {!result.blocks.length && (
            <EmptyState
              icon={Clock3}
              title="No sessions proposed"
              description="Opt a task or project into previews and add an estimate. Any placement problems appear below."
            />
          )}
          {result.warnings.map((w) => (
            <div className="schedule-item" key={w.task_id}>
              <TriangleAlert size={16} className="danger-text" />
              <div>
                <strong>{w.title}</strong>
                <p>
                  {w.reason}
                  {w.remaining_minutes !== null
                    ? ` ${w.remaining_minutes} min remain unplaced.`
                    : ""}
                </p>
              </div>
            </div>
          ))}
          <div className="panel-footer">
            No calendar changes were made. Planned around{" "}
            {result.calendar_count} selected Google calendars. Preview expires
            after ten minutes.
          </div>
        </section>
      )}
    </div>
  );
}
