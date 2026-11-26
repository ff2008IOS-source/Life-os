"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { affects, announceChange } from "@/lib/workspace-change";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
type Decision = {
  id: string;
  job_type: string;
  status?: string;
  payload: {
    title: string;
    block_id: string;
    original_start: string;
    original_end: string;
    deadline: string | null;
    reason: string;
    replacement: { start_at: string; end_at: string } | null;
    terminal?: boolean;
    recurring?: boolean;
    requested_action?: string;
    requested_minutes?: number;
    outcome?: string;
    decided_at?: string;
    task_id?: string;
  };
};
export function PlanningDecisions({
  review = false,
  initial,
  needsCheck = false,
  checkKey = "",
}: {
  review?: boolean;
  initial?: Decision[];
  needsCheck?: boolean;
  checkKey?: string;
}) {
  const lastChecked = useRef("");
  const [history, setHistory] = useState<Decision[] | null>(null),
    [historyPage, setHistoryPage] = useState(0),
    [historyMore, setHistoryMore] = useState(false),
    [historyError, setHistoryError] = useState("");
  async function loadHistory(page = 0) {
    try {
      const result = await calendarRequest<{
        decisions: Decision[];
        more: boolean;
      }>(`/api/v1/planning/decisions?history=true&page=${page}`);
      setHistory(result.decisions);
      setHistoryPage(page);
      setHistoryMore(result.more);
      setHistoryError("");
    } catch {
      setHistoryError("Decision history could not load.");
    }
  }
  const { data, notify, refresh } = useWorkspace();
  const historyControl = review ? (
    <details
      className="workspace-section"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadHistory();
      }}
    >
      <summary>Past work-block decisions</summary>
      {history === null && !historyError && (
        <p role="status">Loading decision history…</p>
      )}
      {historyError && (
        <p role="alert">
          {historyError}
          <Button variant="ghost" onClick={() => void loadHistory(historyPage)}>
            Retry history
          </Button>
        </p>
      )}
      {history?.map((row) => (
        <p key={row.id}>
          {row.payload.title} ·{" "}
          {formatInTimeZone(
            row.payload.original_start,
            data.profile.timezone,
            "MMM d, h:mm a",
          )}{" "}
          · {(row.payload.outcome ?? "superseded").replaceAll("_", " ")}
        </p>
      ))}
      {history !== null && !history.length && !historyError && (
        <p className="small muted">No recorded block decisions.</p>
      )}
      <div className="inline">
        <Button
          variant="ghost"
          size="sm"
          disabled={historyPage === 0}
          onClick={() => void loadHistory(historyPage - 1)}
        >
          Previous decisions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!historyMore}
          onClick={() => void loadHistory(historyPage + 1)}
        >
          Next decisions
        </Button>
      </div>
    </details>
  ) : null;
  const [rows, setRows] = useState<Decision[]>(initial ?? []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [completion, setCompletion] = useState<Decision | null>(null),
    [minutes, setMinutes] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await calendarRequest<{ decisions: Decision[] }>(
        "/api/v1/planning/decisions",
      );
      setRows(result.decisions);
      setError("");
    } catch {
      setError("Work-block decisions could not load.");
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (needsCheck && lastChecked.current !== checkKey) {
        lastChecked.current = checkKey;
        void calendarRequest("/api/v1/planning/decisions", {
          method: "POST",
          body: JSON.stringify({ action: "check" }),
        })
          .then(load)
          .catch(() =>
            setError("Missed-block check could not load. Retry in Planner."),
          );
      } else if (!initial) void load();
    }, 0);
    const changed = (event: Event) => {
      if (affects(event, ["calendar", "planning", "assessments", "work"]))
        void load();
    };
    window.addEventListener("lifeos:changed", changed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("lifeos:changed", changed);
    };
  }, [load, initial, needsCheck, checkKey]);
  async function decide(
    id: string,
    action: string,
    recordedMinutes = Number(minutes),
  ) {
    setBusy(id);
    setError("");
    try {
      await calendarRequest("/api/v1/planning/decisions", {
        method: "POST",
        body: JSON.stringify({
          id,
          action,
          ...(action === "completed" ? { minutes: recordedMinutes } : {}),
        }),
      });
      setRows((previous) => previous.filter((r) => r.id !== id));
      setCompletion(null);
      notify("Work-block decision saved");
      announceChange(["planning", "calendar", "work"]);
      try {
        await refresh();
      } catch {
        notify("Decision saved · details refresh pending", undefined, {
          label: "Refresh saved work",
          action: refresh,
        });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Decision could not be confirmed. Retry uses the same decision.",
      );
    } finally {
      setBusy("");
    }
  }
  const visible = rows.filter(
    (r) => !review || r.job_type === "missed_block_decision",
  );
  if (!visible.length && !error)
    return (
      <div className="planning-check">
        {historyControl}
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={async () => {
            setBusy("check");
            try {
              await calendarRequest("/api/v1/planning/decisions", {
                method: "POST",
                body: JSON.stringify({ action: "check" }),
              });
              await load();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Planning check failed.",
              );
            } finally {
              setBusy("");
            }
          }}
        >
          Check for missed work blocks
        </Button>
      </div>
    );
  return (
    <section className="workspace-section" aria-label="Work-block decisions">
      <h2>
        {review ? "Unresolved work blocks" : "Changes needing a decision"}
      </h2>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Retry decisions
          </Button>
        </p>
      )}
      {visible.map((row) => (
        <article className="planning-decision" key={row.id}>
          <h3>{row.payload.title}</h3>
          <p className="small">
            {formatInTimeZone(
              row.payload.original_start,
              data.profile.timezone,
              "EEE, MMM d · h:mm a",
            )}{" "}
            –{" "}
            {formatInTimeZone(
              row.payload.original_end,
              data.profile.timezone,
              "h:mm a",
            )}
          </p>
          <p className="small muted">{row.payload.reason}</p>
          {row.payload.replacement && (
            <p>
              Proposed:{" "}
              {formatInTimeZone(
                row.payload.replacement.start_at,
                data.profile.timezone,
                "EEE, MMM d · h:mm a",
              )}{" "}
              –{" "}
              {formatInTimeZone(
                row.payload.replacement.end_at,
                data.profile.timezone,
                "h:mm a",
              )}
            </p>
          )}
          {row.status === "running" && row.payload.requested_action ? (
            <div className="inline">
              <p role="status">The earlier decision needs confirmation.</p>
              <Button
                size="sm"
                disabled={busy === row.id}
                onClick={() =>
                  void decide(
                    row.id,
                    row.payload.requested_action!,
                    row.payload.requested_minutes,
                  )
                }
              >
                Retry the same decision
              </Button>
              <Link href="/planner?section=calendar">Open Planner</Link>
            </div>
          ) : (
            <div className="inline">
              {row.payload.replacement && (
                <Button
                  size="sm"
                  disabled={busy === row.id}
                  onClick={() => void decide(row.id, "accept")}
                >
                  {row.job_type === "missed_block_decision"
                    ? "Reschedule this block"
                    : "Accept move"}
                </Button>
              )}
              {row.job_type === "missed_block_decision" &&
                !row.payload.terminal &&
                !row.payload.recurring && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === row.id}
                      onClick={() => {
                        setCompletion(row);
                        setMinutes("");
                      }}
                    >
                      Completed this block
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === row.id}
                      onClick={() => void decide(row.id, "still_planned")}
                    >
                      Still planned
                    </Button>
                  </>
                )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === row.id}
                onClick={() => void decide(row.id, "drop")}
              >
                Drop this block
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === row.id}
                onClick={() => void decide(row.id, "dismiss")}
              >
                Dismiss proposal
              </Button>
              <Link href="/planner?section=calendar">Open Planner</Link>
            </div>
          )}
          {row.payload.recurring && (
            <p className="small muted">
              Complete recurring occurrences from the linked task in Planner.
            </p>
          )}
          <p className="small muted">
            This decision concerns one work block. The task and official
            deadline stay intact.
          </p>
        </article>
      ))}
      {historyControl}
      <Modal
        open={!!completion}
        onOpenChange={(open) => !open && setCompletion(null)}
        title="Record this work block"
        description="This records work on one occurrence; it does not complete the larger task or assignment."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (completion) void decide(completion.id, "completed");
          }}
        >
          <label>
            Actual minutes worked
            <input
              type="number"
              min="1"
              max="1440"
              required
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={!!busy}>
            Save block outcome
          </Button>
        </form>
      </Modal>
    </section>
  );
}
