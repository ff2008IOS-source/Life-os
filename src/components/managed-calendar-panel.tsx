"use client";
import { useEffect, useState, useCallback } from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
type Review = {
  block_id: string;
  task_id: string;
  state: string;
  reason: string;
  checked_at: string;
  last_provider_etag: string | null;
};
export function ManagedCalendarPanel() {
  const { data, refresh } = useWorkspace();
  const [pending, setPending] = useState<
    { idempotency_key: string; payload: { block_id: string } }[]
  >([]);
  const [rows, setRows] = useState<Review[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const x = await calendarRequest<{
      records: Review[];
      pending: { idempotency_key: string; payload: { block_id: string } }[];
    }>("/api/v1/calendar/managed");
    setRows(x.records);
    setPending(x.pending ?? []);
  }, []);
  useEffect(() => {
    let live = true;
    void calendarRequest<{
      records: Review[];
      pending: { idempotency_key: string; payload: { block_id: string } }[];
    }>("/api/v1/calendar/managed")
      .then((x) => {
        if (live) {
          setRows(x.records);
          setPending(x.pending ?? []);
        }
      })
      .catch(() => {
        if (live) setError("Calendar review status could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, [data.tasks]);
  if (!rows.length && !pending.length && !error) return null;
  return (
    <section className="panel settings-panel">
      <h2>Calendar changes to review</h2>
      <p className="small muted">
        These tasks are held from automatic replanning. Your personal calendars
        remain read-only.
      </p>
      {pending.map((p) => (
        <div className="setting-line" key={p.idempotency_key}>
          <p>
            A calendar move is awaiting provider confirmation. Planning remains
            paused until it is confirmed.
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await calendarRequest("/api/v1/calendar/managed/move", {
                  method: "POST",
                  body: JSON.stringify({
                    action: "retry",
                    request_id: p.idempotency_key,
                    confirmed: true,
                  }),
                });
                await load();
                await refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Confirmation failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry confirmation
          </Button>
        </div>
      ))}
      {rows.map((row) => (
        <div className="setting-line" key={row.block_id}>
          <div>
            <strong>
              {data.tasks.find((t) => t.id === row.task_id)?.title ??
                "Linked work session"}
            </strong>
            <p>{row.reason}</p>
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              const resume = row.state === "externally_cancelled";
              if (
                !confirm(
                  resume
                    ? "Resume automatic planning for this task? This can allow a new reservation under your automation settings."
                    : "Accept the current Google time as a fixed session? Review the conflict above first. Google will not be edited.",
                )
              )
                return;
              setBusy(true);
              setError("");
              try {
                await calendarRequest("/api/v1/calendar/managed", {
                  method: "POST",
                  body: JSON.stringify({
                    block_id: row.block_id,
                    checked_at: row.checked_at,
                    etag: row.last_provider_etag,
                    action: resume ? "resume_planning" : "accept_google",
                    confirmed: true,
                  }),
                });
                await load();
                await refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Calendar review failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {row.state === "externally_cancelled"
              ? "Resume planning"
              : "Accept Google time"}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
