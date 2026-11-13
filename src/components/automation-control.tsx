"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import type { Policy } from "@/lib/scheduler";
export type AutomationState = {
  policy: Policy;
  version: number;
  enabled: boolean;
  last_status: string | null;
  last_error: string | null;
};
export function AutomationControl({
  policy,
  state,
  onSaved,
}: {
  policy: Policy;
  state: AutomationState | null;
  onSaved: (state: AutomationState) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const hasDraft =
    state &&
    (Object.keys(policy) as (keyof Policy)[]).some(
      (key) => policy[key] !== state.policy[key],
    );
  return (
    <section className="panel settings-panel">
      <div className="flex-between">
        <div>
          <h2>Automatic scheduling</h2>
          <p className="muted small">
            {state?.enabled
              ? "On · checks for eligible work automatically"
              : "Off · plan sessions when you’re ready"}
          </p>
        </div>
        <Button
          size="sm"
          variant={state?.enabled ? "outline" : "default"}
          disabled={busy || !state || (!state.enabled && Boolean(hasDraft))}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const next = !state!.enabled;
              const saved = await calendarRequest<AutomationState>(
                "/api/v1/schedule/automation",
                {
                  method: "POST",
                  body: JSON.stringify({
                    enabled: next,
                    version: state!.version,
                  }),
                },
              );
              onSaved(saved);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Setting could not be saved.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : state?.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
      {hasDraft && !state?.enabled && (
        <p className="form-hint">
          Save your planning preferences before turning this on.
        </p>
      )}
      <p className="form-hint">
        Schedules estimated tasks from enabled projects or tasks you mark
        eligible. Existing reservations stay fixed. Your other Google calendars
        stay protected.
      </p>
      {state?.enabled && state.last_status === "idle" && (
        <p className="form-hint">
          Ready. Add a task with an estimate to one of your active projects to
          start scheduling.
        </p>
      )}
      {(error || state?.last_error) && (
        <p role="alert" className="error-message">
          {error || state?.last_error}
        </p>
      )}
    </section>
  );
}
