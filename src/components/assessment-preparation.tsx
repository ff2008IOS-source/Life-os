"use client";
import Link from "next/link";
import type { ScheduleResult } from "@/lib/scheduler";
import { useState } from "react";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { TaskEditor, taskValues } from "./task-editor";
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
  const { refresh, notify, mutate } = useWorkspace();
  const [existingTask, setExistingTask] = useState<Task | null>(null);
  const [preparedId, setPreparedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScheduleResult | null>(null),
    [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false),
    [minutes, setMinutes] = useState(""),
    [eligible, setEligible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [task, setTask] = useState<Task | null>(null);
  const submitted = ["submitted", "returned", "excused"].includes(
    String(a.submission_state),
  );
  async function openPreparation() {
    setError("");
    setPreview(null);
    setSaved(false);
    const id = preparedId ?? (a.task_id ? String(a.task_id) : null);
    if (id) {
      setBusy(true);
      try {
        const fresh = await calendarRequest<{ data: Task }>(
          `/api/v1/tasks/${id}`,
        );
        setExistingTask(fresh.data);
        setMinutes(
          fresh.data.estimated_minutes === null
            ? ""
            : String(
                Math.max(
                  0,
                  fresh.data.estimated_minutes -
                    (fresh.data.actual_minutes ?? 0),
                ),
              ),
        );
        setEligible(fresh.data.scheduling_mode === "eligible");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Preparation task could not load.",
        );
        return;
      } finally {
        setBusy(false);
      }
    }
    setOpen(true);
  }
  async function prepare(plan = false) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      let result: { task_id: string };
      const id = preparedId ?? (a.task_id ? String(a.task_id) : null);
      if (id) {
        const current =
          existingTask ??
          (await calendarRequest<{ data: Task }>(`/api/v1/tasks/${id}`)).data;
        const updated = (await mutate(
          "tasks",
          id,
          {
            ...taskValues(current),
            estimated_minutes: (current.actual_minutes ?? 0) + Number(minutes),
            scheduling_mode: eligible ? "eligible" : "manual",
          },
          current.version,
        )) as { data: Task };
        setExistingTask(updated.data);
        result = { task_id: id };
      } else
        result = await calendarRequest<{ task_id: string }>(
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
      setPreparedId(result.task_id);
      setSaved(true);
      if (plan) {
        const automation = await calendarRequest<{
          policy: ScheduleResult["policy"];
        }>("/api/v1/schedule/automation");
        const plan = await calendarRequest<ScheduleResult>(
          "/api/v1/schedule/preview",
          {
            method: "POST",
            body: JSON.stringify({
              policy: automation.policy,
              task_ids: [result.task_id],
            }),
          },
        );
        setPreview(plan);
        return;
      }
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
          {!submitted && !a.dropped && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openPreparation()}
              >
                Plan preparation
              </Button>
              <Link className="text-link" href="/planner?section=schedule">
                Preview study time
              </Link>
            </>
          )}
        </>
      ) : !submitted && !a.dropped ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void openPreparation()}
        >
          Plan preparation
        </Button>
      ) : null}
      {error && !open && <p role="alert">{error}</p>}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={`Prepare: ${String(a.title)}`}
        description="Add a study task for this assessment."
      >
        {saved && (
          <p role="status">
            Preparation task saved.{" "}
            {error && "Plan details need another check."}
          </p>
        )}
        {preview && (
          <section aria-label="Preparation preview">
            <h3>Proposed study sessions</h3>
            <ul>
              {preview.blocks.map((b, i) => (
                <li key={i}>
                  {new Intl.DateTimeFormat("en-CA", {
                    timeZone: preview.policy.timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(b.start_at))}{" "}
                  · {b.minutes} min
                </li>
              ))}
            </ul>
            {preview.warnings.map((w, i) => (
              <p key={i} role="status">
                {w.remaining_minutes !== null
                  ? `${w.remaining_minutes} min unplaced: `
                  : ""}
                {w.reason}
              </p>
            ))}
            {preview.blocks.length > 0 && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await calendarRequest("/api/v1/schedule/reservations", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "apply",
                        run_id: preview.run_id,
                      }),
                    });
                    notify("Preparation sessions saved");
                    setPreview(null);
                    setOpen(false);
                    try {
                      await Promise.all([refresh(), onSaved()]);
                    } catch {
                      notify(
                        "Sessions saved; refresh details to see the latest plan.",
                      );
                    }
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Apply outcome unknown. Retry the same preview to reconcile.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Accept these sessions
              </Button>
            )}
          </section>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void prepare();
          }}
        >
          <p className="small muted">
            Enter the preparation minutes still needed. Recorded work is
            preserved and added to the total estimate. The official assessment
            deadline stays unchanged.
          </p>
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
            Leave this off to schedule it yourself. Finishing preparation never
            submits an assignment.
          </p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy
              ? "Saving…"
              : existingTask
                ? "Save preparation estimate"
                : "Create linked preparation task"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !Number(minutes)}
            onClick={() => void prepare(true)}
          >
            Preview study plan
          </Button>
        </form>
      </Modal>
      {task && <TaskEditor task={task} onClose={() => setTask(null)} />}
    </div>
  );
}
