"use client";
import { visibleArea, availableProject } from "@/lib/visible-areas";
import { formatInTimeZone } from "date-fns-tz";
import { vancouverInputInstant } from "@/lib/local-time-input";
import { RecurrenceEditor } from "./recurrence-editor";
import { useState, useEffect } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import type { Task, TaskInput } from "@/lib/schemas";
import { taskInput } from "@/lib/schemas";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { friendlyDate } from "@/lib/dates";
export function taskValues(task: Task): TaskInput {
  return taskInput.parse(
    Object.fromEntries(
      Object.keys(taskInput.shape).map((k) => [k, task[k as keyof Task]]),
    ),
  );
}
export function TaskEditor({
  task,
  onClose,
  defaultArea,
  defaultTitle = "",
  defaultDescription = "",
  onCreated,
}: {
  task: Task | null;
  onClose: () => void;
  defaultArea?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  onCreated?: (task: Task) => void;
}) {
  const { data, mutate, notify, request, refresh, isPending } = useWorkspace();
  const pending = isPending("tasks", task?.id ?? null);
  const [context, setContext] = useState<{
    courses: { id: string; code: string; title: string }[];
    topics: { id: string; course_id: string; title: string }[];
  }>({ courses: [], topics: [] });
  const [contextError, setContextError] = useState("");
  const [course, setCourse] = useState(task?.course_id ?? "");
  const [topic, setTopic] = useState(task?.topic_id ?? "");
  useEffect(() => {
    let live = true;
    void fetch("/api/v1/work/context", { cache: "no-store" })
      .then((r) => {
        if (!r.ok)
          throw Error(
            "Course and topic links could not be loaded. Existing links will be preserved.",
          );
        return r.json();
      })
      .then((d) => {
        if (live && d) setContext(d);
      })
      .catch((e) => {
        if (live) setContextError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const [error, setError] = useState("");
  const [dueType, setDueType] = useState(task?.due_at ? "timed" : "date");
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    try {
      const values = {
        title: f.get("title"),
        description: f.get("description"),
        status: f.get("status"),
        priority: Number(f.get("priority")),
        area_id: f.get("area_id") || null,
        project_id: f.get("project_id") || null,
        course_id: course || null,
        topic_id: topic || null,
        parent_task_id: task?.parent_task_id ?? null,
        due_date: dueType === "date" ? f.get("due_date") || null : null,
        due_at:
          dueType === "timed"
            ? vancouverInputInstant(String(f.get("due_at") ?? ""), task?.due_at)
            : null,
        due_timezone: "America/Vancouver",
        estimated_minutes: num("estimated_minutes"),
        actual_minutes: num("actual_minutes"),
        scheduling_mode: f.get("eligible") ? "eligible" : "manual",
        priority_order: task?.priority_order ?? null,
        deleted_at: task?.deleted_at ?? null,
      };
      const saved = (await mutate(
        "tasks",
        task?.id ?? null,
        values,
        task?.version,
      )) as { data: Task };
      notify(task ? "Task updated" : "Task captured");
      if (!task && onCreated) onCreated(saved.data);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save task.");
    }
  }
  async function remove() {
    if (!task) return;
    setError("");
    try {
      const response = (await request(`/api/v1/tasks/${task.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: task.version }),
      })) as { data: Task };
      await refresh();
      notify("Task moved to Recently deleted", async () => {
        await mutate(
          "tasks",
          task.id,
          { ...taskValues(response.data), deleted_at: null },
          response.data.version,
        );
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete.");
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={task ? "Task details" : "Capture a task"}
      description="A title is enough. Add details when you need them."
      drawer
    >
      <form onSubmit={submit}>
        <label>
          Title
          <input
            name="title"
            defaultValue={task?.title ?? defaultTitle}
            required
            maxLength={200}
            autoFocus
            placeholder="What needs to get done?"
          />
        </label>
        <label>
          Notes
          <textarea
            name="description"
            defaultValue={task?.description ?? defaultDescription}
            placeholder="Context, links, or a first step…"
            maxLength={10000}
          />
        </label>
        <div className="form-grid">
          <label>
            Status
            <select name="status" defaultValue={task?.status ?? "inbox"}>
              <option value="inbox">Inbox</option>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            Priority
            <select name="priority" defaultValue={task?.priority ?? 2}>
              <option value="4">Urgent</option>
              <option value="3">High</option>
              <option value="2">Normal</option>
              <option value="1">Low</option>
            </select>
          </label>
          <label>
            Life area
            <select
              name="area_id"
              defaultValue={task?.area_id ?? defaultArea ?? ""}
            >
              <option value="">No area</option>
              {data.areas
                .filter(
                  (a) =>
                    visibleArea(a) || a.id === (task?.area_id ?? defaultArea),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Project
            <select name="project_id" defaultValue={task?.project_id ?? ""}>
              <option value="">No project</option>
              {data.projects
                .filter((p) => availableProject(p) || p.id === task?.project_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Linked course
            <select
              name="course_id"
              disabled={!!contextError}
              value={course}
              onChange={(e) => {
                setCourse(e.target.value);
                setTopic("");
              }}
            >
              <option value="">No course</option>
              {context.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Linked study topic
            <select
              name="topic_id"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={!course || !!contextError}
            >
              <option value="">No topic</option>
              {context.topics
                .filter((t) => t.course_id === course)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {contextError && (
          <p role="alert" className="error-message">
            {contextError}
          </p>
        )}
        <fieldset>
          <legend>Deadline</legend>
          <div
            className="segmented"
            style={{ marginBottom: 10, width: "fit-content" }}
          >
            <button
              type="button"
              className={dueType === "date" ? "active" : ""}
              onClick={() => setDueType("date")}
            >
              Date only
            </button>
            <button
              type="button"
              className={dueType === "timed" ? "active" : ""}
              onClick={() => setDueType("timed")}
            >
              Exact time
            </button>
          </div>
          {dueType === "date" ? (
            <label className="form-hint">
              Due date in Vancouver
              <input
                name="due_date"
                type="date"
                defaultValue={task?.due_date ?? ""}
              />
            </label>
          ) : (
            <label className="form-hint">
              Deadline in Vancouver
              <input
                name="due_at"
                type="datetime-local"
                defaultValue={
                  task?.due_at
                    ? formatInTimeZone(
                        task.due_at,
                        "America/Vancouver",
                        "yyyy-MM-dd'T'HH:mm",
                      )
                    : ""
                }
              />
            </label>
          )}
          <p className="form-hint" style={{ marginTop: 7 }}>
            A deadline is separate from a reserved work block.
          </p>
        </fieldset>
        <div className="form-grid">
          <label>
            Estimated minutes
            <input
              name="estimated_minutes"
              type="number"
              min="1"
              max="100000"
              defaultValue={task?.estimated_minutes ?? ""}
              placeholder="Not estimated"
            />
          </label>
          <label>
            Actual minutes
            <input
              name="actual_minutes"
              type="number"
              min="0"
              max="100000"
              defaultValue={task?.actual_minutes ?? ""}
              placeholder="Not recorded"
            />
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            name="eligible"
            defaultChecked={task?.scheduling_mode === "eligible"}
          />
          Schedule this task outside automated projects
        </label>
        <p className="form-hint">
          Tasks in an automated project inherit its setting. When automation is
          on, estimated eligible work can reserve time in your Life OS calendar.
        </p>
        {task && (
          <>
            <TaskLinks task={task} />
            <RecurrenceEditor task={task} />
          </>
        )}{" "}
        {task && (
          <p className="form-hint tech-detail">
            Created {friendlyDate(task.created_at)} · Version {task.version} ·
            Source: {task.source_type}
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {task &&
            !task.deleted_at &&
            (confirmDelete ? (
              <Button
                type="button"
                variant="danger"
                className="left"
                onClick={remove}
              >
                Confirm deletion
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="left"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
                Delete
              </Button>
            ))}
          {task?.deleted_at && (
            <Button
              type="button"
              variant="outline"
              className="left"
              onClick={async () => {
                try {
                  await mutate(
                    "tasks",
                    task.id,
                    { ...taskValues(task), deleted_at: null },
                    task.version,
                  );
                  notify("Task restored");
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Restore failed");
                }
              }}
            >
              <RotateCcw size={15} />
              Restore
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function TaskLinks({ task }: { task: Task }) {
  const { data, request, refresh, notify } = useWorkspace();
  const [error, setError] = useState("");
  const [goal, setGoal] = useState("");
  const [predecessor, setPredecessor] = useState("");
  async function link(kind: "goal" | "dependency", id: string, remove = false) {
    setError("");
    try {
      await request(`/api/v1/tasks/${task.id}/links`, {
        method: remove ? "DELETE" : "POST",
        body: JSON.stringify({ kind, id }),
      });
      await refresh();
      notify(remove ? "Link removed" : "Link added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    }
  }
  return (
    <fieldset>
      <legend>Connections</legend>
      <p className="form-hint" style={{ marginBottom: 10 }}>
        Link goals or add prerequisites. Circular dependencies are rejected.
      </p>
      <div className="inline">
        <select
          aria-label="Goal to link"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        >
          <option value="">Select goal</option>
          {data.goals.map((g) => (
            <option value={g.id} key={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!goal}
          onClick={() => link("goal", goal)}
        >
          Link
        </Button>
      </div>
      <div className="inline" style={{ marginTop: 10 }}>
        <select
          aria-label="Prerequisite task"
          value={predecessor}
          onChange={(e) => setPredecessor(e.target.value)}
        >
          <option value="">Select prerequisite</option>
          {data.tasks
            .filter((t) => t.id !== task.id && !t.deleted_at)
            .map((t) => (
              <option value={t.id} key={t.id}>
                {t.title}
              </option>
            ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!predecessor}
          onClick={() => link("dependency", predecessor)}
        >
          Add
        </Button>
      </div>
      {data.goalTasks
        .filter((l) => l.task_id === task.id)
        .map((l) => (
          <div className="flex-between" key={l.goal_id}>
            <span className="form-hint">
              Goal:{" "}
              {data.goals.find((g) => g.id === l.goal_id)?.title ??
                "Unavailable goal"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => link("goal", l.goal_id, true)}
            >
              Unlink
            </Button>
          </div>
        ))}
      {data.dependencies
        .filter((d) => d.successor_task_id === task.id)
        .map((d) => (
          <div className="flex-between" key={d.predecessor_task_id}>
            <span className="form-hint">
              After:{" "}
              {data.tasks.find((t) => t.id === d.predecessor_task_id)?.title ??
                "Unavailable task"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => link("dependency", d.predecessor_task_id, true)}
            >
              Remove
            </Button>
          </div>
        ))}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </fieldset>
  );
}
