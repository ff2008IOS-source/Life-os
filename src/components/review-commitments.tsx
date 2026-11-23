"use client";
import { stamp } from "@/lib/display";
import { useCallback, useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { TaskEditor } from "./task-editor";
import type { Review, Task } from "@/lib/schemas";
type Item = {
  id: string;
  week: string;
  carried: boolean;
  task: Pick<Task, "id" | "title" | "status" | "due_at" | "due_date">;
};
type State = {
  items: Item[];
  incomplete: boolean;
  snapshot: {
    captured_at: string;
    facts: {
      as_of: string;
      weekly?: { completed_tasks: number; reported_minutes: number };
      source_errors?: string[];
    };
  } | null;
};
export function ReviewCommitments({
  review,
  onOpening,
}: {
  review: Review;
  onOpening: (text: string) => void;
}) {
  const { data, refresh } = useWorkspace();
  const [state, setState] = useState<State | null>(null),
    [taskId, setTaskId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<Task | null>(null);
  const load = useCallback(async () => {
    const next = await calendarRequest<State>(
      "/api/v1/reviews/context?review=" + review.id,
    );
    setState(next);
    const carried = next.items.find((x) => x.carried);
    onOpening(
      carried
        ? `Your earlier approved commitment, ${carried.task.title}, remains open in your current records. What progress have you made, and what got in the way?`
        : "",
    );
    return next;
  }, [review.id, onOpening]);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(load)
      .then(async (next) => {
        if (live && !next.snapshot) {
          await calendarRequest("/api/v1/reviews/context", {
            method: "POST",
            body: JSON.stringify({ action: "capture", review_id: review.id }),
          });
          if (live) await load();
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [load, review.id]);
  async function approve() {
    setBusy(true);
    setError("");
    try {
      await calendarRequest("/api/v1/reviews/context", {
        method: "POST",
        body: JSON.stringify({
          action: "approve_commitment",
          review_id: review.id,
          task_id: taskId,
          confirmed: true,
        }),
      });
      setTaskId("");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Commitment could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel settings-panel"
      aria-label="Approved review commitments"
    >
      <h2>Follow through</h2>
      <p className="small muted">
        The promises you’re carrying into this week.
      </p>
      {state?.items.map((x) => (
        <div className="setting-line" key={x.id}>
          <div>
            <strong>{x.task.title}</strong>
            <p className="small muted">
              {x.carried ? `Carried from ${x.week}` : "Approved this review"} ·{" "}
              {x.task.status.replaceAll("_", " ")} ·{" "}
              {x.task.due_date ??
                (x.task.due_at
                  ? "Timed deadline recorded"
                  : "No deadline recorded")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                setEditor(
                  (
                    await calendarRequest<{ data: Task }>(
                      `/api/v1/tasks/${x.task.id}`,
                    )
                  ).data,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Task unavailable.");
              }
            }}
          >
            Review task
          </Button>
        </div>
      ))}
      {!state?.items.length && (
        <p className="small muted">
          No commitments yet. Choose a task to make it part of your week.
        </p>
      )}
      {state?.incomplete && (
        <p role="alert">
          Older commitment history exceeds this view’s limit. Current results
          are incomplete.
        </p>
      )}
      {!review.completed_at && (
        <details className="briefing-detail">
          <summary>Choose priorities for next week</summary>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void approve();
            }}
          >
            <label>
              Task to commit to
              <select
                required
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
              >
                <option value="">Choose an existing unfinished task</option>
                {data.tasks
                  .filter(
                    (t) =>
                      !t.deleted_at &&
                      t.source_type !== "test" &&
                      !t.is_example &&
                      !["completed", "cancelled"].includes(t.status) &&
                      !state?.items.some((x) => x.task.id === t.id),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <Button disabled={!taskId || busy}>Approve commitment</Button>
            <p className="small muted">
              Have something new in mind? Draft a task from your review, then
              choose it here.
            </p>
          </form>
        </details>
      )}
      {state?.snapshot && (
        <details className="briefing-detail">
          <summary>At the start of this review</summary>
          <p className="small">
            Captured {stamp(state.snapshot.captured_at)}. Data as of{" "}
            {stamp(state.snapshot.facts.as_of)}. Later source edits do not
            rewrite this saved snapshot.
          </p>
          <p className="small">
            {state.snapshot.facts.weekly?.completed_tasks ?? "Unknown"} tasks
            recorded complete;{" "}
            {state.snapshot.facts.weekly?.reported_minutes ?? "Unknown"} minutes
            reported. This is a saved view of records, not reconstructed
            external history.
          </p>
          {!!state.snapshot.facts.source_errors?.length && (
            <p className="small">
              Unavailable sources at capture:{" "}
              {state.snapshot.facts.source_errors.join(", ")}.
            </p>
          )}
        </details>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {editor && (
        <TaskEditor
          task={editor}
          onClose={() => {
            setEditor(null);
            void Promise.all([load(), refresh()]);
          }}
        />
      )}
    </section>
  );
}
