"use client";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import type { Policy } from "@/lib/scheduler";
type State = {
  enabled: boolean;
  last_status: string | null;
  last_error: string | null;
};
export function AutomationControl({ policy }: { policy: Policy }) {
  const [state, setState] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void calendarRequest<State>("/api/v1/schedule/automation")
      .then((d) => {
        if (live) setState(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="panel settings-panel">
      <div className="flex-between">
        <div>
          <h2>Automatic scheduling</h2>
          <p className="muted small">
            {state?.enabled
              ? "On · checks every 15 minutes"
              : "Off · preview sessions manually"}
          </p>
        </div>
        <Button
          size="sm"
          variant={state?.enabled ? "outline" : "default"}
          disabled={busy || !state}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const next = !state!.enabled;
              await calendarRequest("/api/v1/schedule/automation", {
                method: "POST",
                body: JSON.stringify({ enabled: next, policy }),
              });
              setState({ ...state!, enabled: next });
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
      {state?.enabled && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await calendarRequest("/api/v1/schedule/automation", {
                method: "POST",
                body: JSON.stringify({ enabled: true, policy }),
              });
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Boundaries could not be saved.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save boundaries
        </Button>
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
