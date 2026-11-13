"use client";
import { useState, useEffect } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { useWorkspace } from "./workspace-provider";
import { calendarRequest } from "./use-calendar";
import { vancouverInputInstant } from "@/lib/local-time-input";
import type { WorkBlock, WorkState } from "@/lib/work-session";
import { TIMEZONE } from "@/lib/dates";
export function WorkSessionsPanel({
  compact = false,
  start,
  end,
}: {
  compact?: boolean;
  start?: string;
  end?: string;
}) {
  const { data: workspace, refresh } = useWorkspace();
  const [state, setState] = useState<WorkState | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [visible, setVisible] = useState(8),
    [selected, setSelected] = useState<WorkBlock | null>(null),
    [moving, setMoving] = useState<WorkBlock | null>(null);
  const query = new URLSearchParams({
    page: String(page),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  }).toString();
  useEffect(() => {
    let live = true;
    void calendarRequest<WorkState>("/api/v1/work/sessions?" + query)
      .then((x) => {
        if (live) {
          setState(x);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [query, workspace.tasks]);
  return (
    <section className="panel settings-panel">
      <div className="academic-toolbar">
        <h2>{compact ? "Recorded work" : "Work sessions"}</h2>
        <span className="badge">
          {state ? `${state.summary.session_count} recorded` : "Loading…"}
        </span>
      </div>
      {state && (
        <p className="small muted">
          {state.summary.actual_minutes} minutes logged ·{" "}
          {state.summary.academic_minutes} academic minutes ·{" "}
          {state.summary.tasks_completed} tasks marked complete
        </p>
      )}
      <details className="metric-details">
        <summary>How this is measured</summary>{" "}
        <p className="form-hint">
          {state
            ? `${state.period.start} to ${state.period.end} (end exclusive). `
            : ""}
          Totals use when completion was recorded and the actual minutes you
          entered. Planned time is not completed work.
        </p>
      </details>
      {!compact && (
        <>
          <div className="academic-record-list">
            {state?.blocks.slice(0, visible).map((block) => (
              <div className="setting-line" key={block.id}>
                <div>
                  <strong>
                    {workspace.tasks.find((t) => t.id === block.task_id)
                      ?.title ?? "Linked task"}
                  </strong>
                  <p>
                    {formatInTimeZone(
                      block.start_at,
                      TIMEZONE,
                      "MMM d · h:mm a",
                    )}
                    –{formatInTimeZone(block.end_at, TIMEZONE, "h:mm a")}
                  </p>
                </div>
                {block.provider_event_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMoving(block)}
                  >
                    Move session
                  </Button>
                )}
                <Button size="sm" onClick={() => setSelected(block)}>
                  Record work
                </Button>
              </div>
            ))}
          </div>
          {state && !state.blocks.length && (
            <p className="muted small">
              No planned work sessions on this page. Generate and reserve a
              schedule to get started.
            </p>
          )}
          <div className="career-import-actions">
            {page > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => p - 1)}
              >
                Previous sessions
              </Button>
            )}
            {(state?.has_more ||
              (!!state && state.blocks.length > visible)) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (state && visible < state.blocks.length)
                    setVisible((v) => v + 8);
                  else {
                    setPage((p) => p + 1);
                    setVisible(8);
                  }
                }}
              >
                More sessions
              </Button>
            )}
          </div>
        </>
      )}
      {!!state?.completions.length && (
        <details>
          <summary className="text-link">Recent completion records</summary>
          {state.completions.map((c) => (
            <div className="setting-line" key={c.id}>
              <div>
                <strong>
                  {workspace.tasks.find((t) => t.id === c.task_id)?.title ??
                    "Linked task"}
                </strong>
                <p>
                  {c.actual_minutes} reported min ·{" "}
                  {c.actual_start_at
                    ? "Actual times recorded"
                    : "Actual times unknown"}
                  {c.practiced_topic ? " · Topic practice recorded" : ""}
                </p>
              </div>
            </div>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {moving && (
        <MoveSessionDialog
          block={moving}
          onClose={() => setMoving(null)}
          onSaved={async () => {
            await refresh();
            setState(
              await calendarRequest<WorkState>(
                "/api/v1/work/sessions?" + query,
              ),
            );
            setMoving(null);
          }}
        />
      )}
      {selected && (
        <CompletionDialog
          block={selected}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            await refresh();
            setState(
              await calendarRequest<WorkState>(
                "/api/v1/work/sessions?" + query,
              ),
            );
            setSelected(null);
          }}
        />
      )}
    </section>
  );
}
function CompletionDialog({
  block,
  onClose,
  onSaved,
}: {
  block: WorkBlock;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data } = useWorkspace();
  const task = data.tasks.find((t) => t.id === block.task_id);
  const [requestId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title="Record completed work"
      description="Report what you actually did. Scheduled duration is not an effort estimate for this completion."
    >
      <form
        className="academic-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const instant = (name: string) => {
              const v = String(f.get(name) ?? "");
              return vancouverInputInstant(v);
            };
            await calendarRequest(
              `/api/v1/work/sessions/${block.id}/complete`,
              {
                method: "POST",
                body: JSON.stringify({
                  request_id: requestId,
                  version: block.version,
                  actual_minutes: Number(f.get("actual_minutes")),
                  actual_start_at: instant("actual_start_at"),
                  actual_end_at: instant("actual_end_at"),
                  finish_task: f.has("finish_task"),
                  practiced_topic: f.has("practiced_topic"),
                  notes: f.get("notes") ?? "",
                }),
              },
            );
            await onSaved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Work could not be recorded.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="small">{task?.title}</p>
        <label>
          Actual minutes worked
          <input
            name="actual_minutes"
            type="number"
            min={1}
            max={1440}
            required
            placeholder="Enter actual effort"
          />
        </label>
        <details>
          <summary className="text-link">Actual times, if known</summary>
          <div className="form-grid">
            <label>
              Actual start (Vancouver)
              <input name="actual_start_at" type="datetime-local" />
            </label>
            <label>
              Actual end (Vancouver)
              <input name="actual_end_at" type="datetime-local" />
            </label>
          </div>
        </details>
        <label className="inline-check">
          <input name="finish_task" type="checkbox" />
          The whole task is now complete
        </label>
        {task?.topic_id && (
          <label className="inline-check">
            <input name="practiced_topic" type="checkbox" />I practiced the
            linked topic
          </label>
        )}
        <label>
          Work notes
          <textarea name="notes" maxLength={2000} />
        </label>
        <p className="form-hint">
          This updates effort and linked academic history. It does not award a
          grade, mark mastery, complete the entire project, or cancel other
          calendar events.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Recording…" : "Save completed work"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MoveSessionDialog({
  block,
  onClose,
  onSaved,
}: {
  block: WorkBlock;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title="Move work session"
      description="Choose a new time in Vancouver. Life OS checks current calendars, deadlines, breaks and the freeze window before updating only this dedicated-calendar event."
    >
      <form
        className="academic-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const start = vancouverInputInstant(String(f.get("start"))),
              end = vancouverInputInstant(String(f.get("end")));
            if (!start || !end)
              throw Error("Enter a valid start and end time.");
            await calendarRequest("/api/v1/calendar/managed/move", {
              method: "POST",
              body: JSON.stringify({
                action: "move",
                request_id: requestId,
                block_id: block.id,
                version: block.version,
                start_at: start,
                end_at: end,
                confirmed: true,
              }),
            });
            await onSaved();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "The session could not be moved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Start (Vancouver)
          <input
            name="start"
            type="datetime-local"
            required
            defaultValue={formatInTimeZone(
              block.start_at,
              TIMEZONE,
              "yyyy-MM-dd'T'HH:mm",
            )}
          />
        </label>
        <label>
          End (Vancouver)
          <input
            name="end"
            type="datetime-local"
            required
            defaultValue={formatInTimeZone(
              block.end_at,
              TIMEZONE,
              "yyyy-MM-dd'T'HH:mm",
            )}
          />
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy
            ? "Checking and confirming…"
            : "Confirm move in Google Calendar"}
        </Button>
      </form>
    </Modal>
  );
}
