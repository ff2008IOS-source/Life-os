"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { TaskEditor } from "./task-editor";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import type { AcademicRow } from "./academic-editor";
import type { Task } from "@/lib/schemas";
export function AssessmentPreparation({
  assessment: a,
  onSaved,
}: {
  assessment: AcademicRow;
  onSaved: () => Promise<void>;
}) {
  const { refresh } = useWorkspace();
  const [open, setOpen] = useState(false),
    [minutes, setMinutes] = useState(""),
    [eligible, setEligible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [task, setTask] = useState<Task | null>(null);
  const submitted = ["submitted", "returned", "excused"].includes(
    String(a.submission_state),
  );
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const result = await calendarRequest<{ task_id: string }>(
        "/api/v1/academics/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            assessment_id: a.id,
            version: a.version,
            estimated_minutes: Number(minutes),
            eligible,
          }),
        },
      );
      const fresh = await calendarRequest<{ data: Task }>(
        `/api/v1/tasks/${result.task_id}`,
      );
      await Promise.all([onSaved(), refresh()]);
      setOpen(false);
      setTask(fresh.data);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Preparation could not be saved. Retry safely; existing links are preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inline academic-note">
      {a.task_id ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                setTask(
                  (
                    await calendarRequest<{ data: Task }>(
                      `/api/v1/tasks/${a.task_id}`,
                    )
                  ).data,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Task unavailable.");
              }
            }}
          >
            View preparation task
          </Button>
          <Link className="text-link" href="/planner?tab=scheduling">
            Preview study time
          </Link>
        </>
      ) : !submitted && !a.dropped ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Prepare work
        </Button>
      ) : null}
      {error && !open && <p role="alert">{error}</p>}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={`Prepare: ${String(a.title)}`}
        description="Add a study task for this assessment."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void prepare();
          }}
        >
          <label>
            Estimated preparation minutes
            <input
              type="number"
              min="1"
              max="100000"
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={eligible}
              onChange={(e) => setEligible(e.target.checked)}
            />
            Allow scheduling under my current automation preferences
          </label>
          <p className="small muted">
            Recorded deadline verification:{" "}
            {String(a.verification_status ?? "unverified").replaceAll("_", " ")}
            . Leave this off to keep the task manual. Completing preparation
            never submits an assignment or marks a topic mastered.
          </p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Create linked preparation task"}
          </Button>
        </form>
      </Modal>
      {task && <TaskEditor task={task} onClose={() => setTask(null)} />}
    </div>
  );
}
