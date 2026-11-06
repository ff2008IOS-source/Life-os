"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { calendarRequest, useCalendar } from "./use-calendar";
type State = {
  calendars: { id: string; name: string }[];
  runs: {
    id: string;
    status: string;
    applied_count: number;
    started_at: string;
    error_summary: string | null;
  }[];
};
export function ReservationsPanel({
  runId,
  onApplied,
}: {
  runId?: string;
  onApplied?: () => void;
}) {
  const { data: connections } = useCalendar();
  const [state, setState] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const reload = useCallback(
    async () =>
      setState(await calendarRequest<State>("/api/v1/schedule/reservations")),
    [],
  );
  useEffect(() => {
    let active = true;
    void calendarRequest<State>("/api/v1/schedule/reservations")
      .then((x) => {
        if (active) setState(x);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const result = await calendarRequest<{
        removed?: number;
        applied?: number;
        conflicts?: string[];
      }>("/api/v1/schedule/reservations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMessage(
        result.conflicts?.length
          ? result.conflicts.join(" ")
          : result.removed !== undefined
            ? `${result.removed} sessions removed.`
            : result.applied !== undefined
              ? `${result.applied} sessions reserved.`
              : "Dedicated calendar ready. Generate a new preview before reserving.",
      );
      await reload();
      onApplied?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Reservation failed.");
      await reload();
    } finally {
      setBusy(false);
    }
  }
  const connection = connections?.connections.find(
    (c) => c.status === "connected",
  );
  return (
    <section className="panel settings-panel">
      <div className="academic-toolbar">
        <h2>Reserve work sessions</h2>
        <span className="badge">Review first</span>
      </div>
      <p className="muted small">
        Reservations go only to a separate Life OS calendar. Automatic
        rescheduling is off. Undo preserves sessions changed in Google and
        sessions within the next hour.
      </p>
      {!state?.calendars.length ? (
        <div className="career-import-actions">
          <Button
            variant="outline"
            disabled={busy || !connection}
            onClick={async () => {
              setBusy(true);
              try {
                const { url } = await calendarRequest<{ url: string }>(
                  "/api/v1/calendar/oauth/start",
                  {
                    method: "POST",
                    body: JSON.stringify({ sheets: true, reservations: true }),
                  },
                );
                location.assign(url);
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "Connection failed.",
                );
                setBusy(false);
              }
            }}
          >
            Grant separate-calendar permission
          </Button>
          <Button
            disabled={busy || !connection}
            onClick={() =>
              void act({ action: "setup", connection_id: connection!.id })
            }
          >
            Create Life OS calendar
          </Button>
        </div>
      ) : (
        <>
          <p className="small">Dedicated calendar connected.</p>
          {runId && (
            <Button
              disabled={busy}
              onClick={() => void act({ action: "apply", run_id: runId })}
            >
              {busy ? "Working…" : "Reserve this preview in Life OS calendar"}
            </Button>
          )}
        </>
      )}
      {!!state?.runs.length && (
        <details>
          <summary className="text-link">Recent reservation runs</summary>
          {state.runs.map((run) => (
            <div className="setting-line" key={run.id}>
              <div>
                <strong>
                  {run.applied_count} confirmed · {run.status}
                </strong>
                {run.error_summary && <p>{run.error_summary}</p>}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act({ action: "undo", run_id: run.id })}
              >
                Undo sessions
              </Button>
            </div>
          ))}
        </details>
      )}
      {message && (
        <p role="status" className="form-hint">
          {message}
        </p>
      )}
    </section>
  );
}
