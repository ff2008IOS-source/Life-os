"use client";
import { remainingEffort } from "@/lib/today-plan";
import { isExample } from "@/lib/real-workspace";
import { useState } from "react";
import {
  Check,
  Plus,
  Inbox,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
} from "lucide-react";
import type { Task } from "@/lib/schemas";
import { friendlyDate, isOverdue } from "@/lib/dates";
import { useWorkspace } from "./workspace-provider";
import { TaskEditor, taskValues } from "./task-editor";
import { availableProject } from "@/lib/visible-areas";
import { DateField } from "./date-field";
import { Button } from "./ui/button";
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: typeof Inbox;
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <span className="empty-icon">
        <Icon size={21} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function QuickCapture({
  areaId,
  projectId,
  dueDate,
}: {
  areaId?: string;
  projectId?: string;
  dueDate?: string;
}) {
  const { data, mutate, notify, isPending } = useWorkspace();
  const pending = isPending("tasks", null);
  const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState(""),
    [error, setError] = useState("");
  return (
    <>
      <div className="quick-capture">
        <Plus size={14} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (!title.trim()) return;
            const form = e.currentTarget,
              f = new FormData(form);
            const project = String(f.get("project_id") ?? projectId ?? "");
            try {
              await mutate("tasks", null, {
                title,
                description: String(f.get("description") ?? ""),
                area_id:
                  areaId ??
                  data.projects.find((p) => p.id === project)?.area_id ??
                  null,
                project_id: project || null,
                due_date: String(f.get("due_date") ?? dueDate ?? "") || null,
                priority: Number(f.get("priority") ?? 2),
                estimated_minutes: f.get("estimated_minutes")
                  ? Number(f.get("estimated_minutes"))
                  : null,
              });
              setTitle("");
              setRevision((n) => n + 1);
              form.reset();
              notify("Task added");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Task could not be added.",
              );
            }
          }}
        >
          <div className="quick-capture-line">
            <input
              name="title"
              aria-label="Quick capture task title"
              placeholder="Add a task…"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button
              variant="ghost"
              type="submit"
              disabled={!title.trim() || pending}
              aria-label="Add task"
            >
              Add
            </Button>
          </div>
          <details>
            <summary>Details</summary>
            <label>
              Description
              <textarea name="description" rows={2} />
            </label>
            <div className="form-grid">
              <DateField
                key={revision}
                name="due_date"
                label="Due date"
                defaultValue={dueDate}
              />
              <label>
                Priority
                <select name="priority" defaultValue="2">
                  <option value="1">Low</option>
                  <option value="2">Normal</option>
                  <option value="3">High</option>
                  <option value="4">Urgent</option>
                </select>
              </label>
              <label>
                Estimate (minutes)
                <input
                  name="estimated_minutes"
                  type="number"
                  min="1"
                  max="100000"
                />
              </label>
              <label>
                Project
                <select name="project_id" defaultValue={projectId ?? ""}>
                  <option value="">No project</option>
                  {data.projects.filter(availableProject).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </form>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function TaskList({
  tasks,
  reorder = false,
  completedExpanded = false,
  allocations,
  referenceDate,
}: {
  tasks: Task[];
  reorder?: boolean;
  completedExpanded?: boolean;
  allocations?: Record<string, number>;
  referenceDate?: Date;
}) {
  const { data, mutate, notify, pending, isPending, request, refresh } =
    useWorkspace();
  tasks = tasks.filter((t) => !isExample(t));
  const completed = tasks.filter(
    (t) => t.status === "completed" && !t.deleted_at,
  );
  const active = tasks.filter(
    (t) => t.status !== "completed" || !!t.deleted_at,
  );
  const displayed = active;
  const [visible, setVisible] = useState(8);
  const [editing, setEditing] = useState<Task | null>(null);
  const [error, setError] = useState("");
  async function complete(task: Task) {
    setError("");
    const status = task.status === "completed" ? "inbox" : "completed";
    try {
      const response = (await mutate(
        "tasks",
        task.id,
        { ...taskValues(task), status },
        task.version,
      )) as { data: Task };
      notify(
        status === "completed" ? "Task completed" : "Task reopened",
        async () => {
          await mutate(
            "tasks",
            task.id,
            taskValues(task),
            response.data.version,
          );
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update");
    }
  }
  async function move(task: Task, direction: number) {
    const index = active.findIndex((t) => t.id === task.id);
    if (index + direction < 0 || index + direction >= active.length) return;
    const ordered = [...active];
    [ordered[index], ordered[index + direction]] = [
      ordered[index + direction],
      ordered[index],
    ];
    try {
      await request("/api/v1/tasks/priorities", {
        method: "POST",
        body: JSON.stringify({
          items: ordered.map((t, i) => ({
            id: t.id,
            version: t.version,
            position: i,
          })),
        }),
      });
      await refresh();
      notify("Priorities reordered");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reorder");
    }
  }

  const renderTask = (task: Task, i: number) => {
    const area = data.areas.find((a) => a.id === task.area_id);
    return (
      <div
        key={task.id}
        className={`task-row ${task.status === "completed" ? "task-completed" : ""}`}
      >
        <button
          className={`task-check ${task.status === "completed" ? "checked" : ""}`}
          disabled={
            isPending("tasks", task.id) ||
            !!task.deleted_at ||
            !!task.recurrence_rule_id
          }
          aria-label={`${task.status === "completed" ? "Reopen" : "Complete"} ${task.title}`}
          onClick={() => complete(task)}
        >
          {task.status === "completed" && <Check size={12} />}
        </button>
        <button className="task-main" onClick={() => setEditing(task)}>
          <span className="task-title">{task.title}</span>
          <span className="task-meta">
            {area && (
              <>
                {area.name}
                <span>·</span>
              </>
            )}
            {allocations?.[task.id] !== undefined
              ? `${Math.round(allocations[task.id])} min planned${task.estimated_minutes === null ? " · full effort unknown" : ""}`
              : task.estimated_minutes === null
                ? "Estimate missing"
                : remainingEffort(task) === 0 && task.status !== "completed"
                  ? "Estimate used up · still open"
                  : `${remainingEffort(task)} min remaining`}
            {task.scheduling_mode === "eligible" && (
              <>
                <span>·</span>
                <span>Ready to schedule</span>
              </>
            )}
          </span>
        </button>
        {task.priority >= 3 && (
          <span className="task-priority">
            {task.priority === 4 ? "Urgent" : "High"}
          </span>
        )}
        <span
          className={`task-due ${isOverdue(task, referenceDate) ? "overdue" : ""}`}
        >
          {task.deleted_at
            ? "Deleted"
            : friendlyDate(task.due_at ?? task.due_date)}
        </span>
        <Button
          className="task-actions"
          variant="ghost"
          size="icon"
          aria-label={`Task actions: ${task.title}`}
          onClick={() => setEditing(task)}
        >
          <MoreHorizontal />
        </Button>
        {reorder && task.status !== "completed" && (
          <div className="inline">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Move ${task.title} up`}
              disabled={i === 0 || pending}
              onClick={() => move(task, -1)}
            >
              <ArrowUp size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Move ${task.title} down`}
              disabled={i === active.length - 1 || pending}
              onClick={() => move(task, 1)}
            >
              <ArrowDown size={12} />
            </Button>
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      {active.slice(0, visible).map(renderTask)}
      {completed.length > 0 && (
        <details
          className="completed-collection"
          open={completedExpanded || undefined}
        >
          <summary>
            <Check size={14} />
            Completed ({completed.length})
          </summary>
          {completed.map(renderTask)}
        </details>
      )}
      {displayed.length > 8 && (
        <div className="list-pagination">
          <span>
            {Math.min(visible, displayed.length)} of {displayed.length} tasks
          </span>
          {visible < displayed.length ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisible((n) => n + 8)}
            >
              Show more tasks
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setVisible(8)}>
              Show fewer tasks
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <TaskEditor
          key={editing.id}
          task={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
