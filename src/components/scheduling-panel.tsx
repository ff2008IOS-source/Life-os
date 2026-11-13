"use client";
import { ManagedCalendarPanel } from "./managed-calendar-panel";
import { useState, useEffect } from "react";
import { Play, ShieldCheck, Clock3, TriangleAlert } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import {
  DEFAULT_POLICY,
  policySchema,
  blockLocalLabel,
  type ScheduleResult,
} from "@/lib/scheduler";
import { type AutomationState, AutomationControl } from "./automation-control";
import { ReservationsPanel } from "./reservations-panel";
import { calendarRequest } from "./use-calendar";
import { EmptyState } from "./task-list";
export function SchedulingPanel() {
  const { data, request, refresh } = useWorkspace();
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [automation, setAutomation] = useState<AutomationState | null>(null);
  const [saving, setSaving] = useState(false),
    [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    let live = true;
    void calendarRequest<AutomationState>("/api/v1/schedule/automation")
      .then((state) => {
        if (live) {
          setAutomation(state);
          setPolicy(policySchema.parse(state.policy ?? {}));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  function applySaved(state: AutomationState) {
    setAutomation(state);
    setPolicy(state.policy);
    setResult(null);
    setSavedMessage("Planning preferences saved.");
  }
  async function savePolicy() {
    if (!automation) return;
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const checked = policySchema.safeParse(policy);
      if (!checked.success)
        throw new Error(
          "Check your work hours and session limits. Each session must fit within your daily cap.",
        );
      const parsed = checked.data;
      applySaved(
        await calendarRequest<AutomationState>("/api/v1/schedule/automation", {
          method: "PATCH",
          body: JSON.stringify({ policy: parsed, version: automation.version }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Preferences could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function changePolicy(value: typeof policy) {
    setPolicy(value);
    setResult(null);
    setSavedMessage("");
  }
  async function reloadSavedPreferences() {
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const state = await calendarRequest<AutomationState>(
        "/api/v1/schedule/automation",
      );
      setAutomation(state);
      setPolicy(policySchema.parse(state.policy ?? {}));
      setSavedMessage("Saved planning preferences loaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preferences could not load.");
    } finally {
      setSaving(false);
    }
  }
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
            Choose your boundaries, review the proposed sessions, then decide
            what to add. Existing commitments stay protected.
          </p>
        </div>
      </div>
      <AutomationControl
        policy={policy}
        state={automation}
        onSaved={(state) => {
          setAutomation(state);
          setResult(null);
        }}
      />
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
            {
              label: "Window",
              value: `${policy.start_hour % 12 || 12} ${policy.start_hour < 12 ? "AM" : "PM"} – ${policy.end_hour % 12 || 12} ${policy.end_hour < 12 ? "AM" : "PM"}`,
            },
            {
              label: "Daily maximum",
              value: `${policy.max_daily_minutes} min`,
            },
            {
              label: "Session length",
              value: `${policy.min_session_minutes}–${policy.max_session_minutes} min`,
            },
            { label: "Between sessions", value: `${policy.break_minutes} min` },
            {
              label: "Protected time",
              value: `Next ${policy.freeze_minutes} min`,
            },
            {
              label: "Plan ahead",
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
            {(
              [
                ["start_hour", "Start hour (24-hour clock)", 9, 20],
                ["end_hour", "End hour (24-hour clock)", 10, 21],
                ["break_minutes", "Break between sessions (minutes)", 10, 60],
                [
                  "freeze_minutes",
                  "Protect upcoming sessions (minutes)",
                  60,
                  1440,
                ],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={policy[key]}
                  onChange={(e) => {
                    changePolicy({ ...policy, [key]: Number(e.target.value) });
                    setResult(null);
                    setSavedMessage("");
                  }}
                />
              </label>
            ))}
            <label>
              Daily cap (minutes)
              <input
                type="number"
                min="25"
                max="240"
                value={policy.max_daily_minutes}
                onChange={(e) =>
                  changePolicy({
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
                  changePolicy({
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
                  changePolicy({
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
                  changePolicy({
                    ...policy,
                    max_session_minutes: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <Button
            onClick={() => void savePolicy()}
            disabled={saving || !automation}
          >
            {saving ? "Saving…" : "Save planning preferences"}
          </Button>
          {savedMessage && <p role="status">{savedMessage}</p>}
        </details>
        <div className="panel-footer flex-between">
          <span>Eligible areas: Academics, Career, Projects</span>
          <Button onClick={preview} disabled={pending || !automation}>
            <Play size={13} />
            {pending ? "Planning…" : "Generate preview"}
          </Button>
        </div>
      </section>
      {error && (
        <div role="alert" className="error-message">
          {error}
          {error.includes("changed elsewhere") && (
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => void reloadSavedPreferences()}
            >
              Reload saved preferences
            </Button>
          )}
        </div>
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
              description="Choose a task to schedule and add a time estimate. We’ll show you if anything won’t fit."
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
            Nothing has been added yet. Planned around {result.calendar_count}{" "}
            selected Google calendars. Preview expires after ten minutes.
          </div>
        </section>
      )}
    </div>
  );
}
