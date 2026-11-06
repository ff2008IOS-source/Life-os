"use client";
import { useState } from "react";
import { Check, Flag, Plus, Inbox, ArrowUp, ArrowDown } from "lucide-react";
import type { Task } from "@/lib/schemas";
import { friendlyDate, isOverdue } from "@/lib/dates";
import { useWorkspace } from "./workspace-provider";
import { TaskEditor, taskValues } from "./task-editor";
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
export function QuickCapture({ areaId }: { areaId?: string }) {
  const { mutate, notify, pending } = useWorkspace();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <div className="quick-capture">
        <Plus size={14} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (!title.trim()) return;
            try {
              await mutate("tasks", null, { title, area_id: areaId ?? null });
              setTitle("");
              notify("Task captured in Inbox");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Capture failed");
            }
          }}
        >
          <input
            aria-label="Quick capture task title"
            placeholder="Capture a task, clear your mind…"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button
            variant="ghost"
            type="submit"
            disabled={!title.trim() || pending}
            aria-label="Capture task"
          >
            ↵
          </Button>
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
}: {
  tasks: Task[];
  reorder?: boolean;
}) {
  const { data, mutate, notify, pending, request, refresh } = useWorkspace();
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
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index + direction < 0 || index + direction >= tasks.length) return;
    const ordered = [...tasks];
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

  return (
    <>
      {tasks.slice(0, visible).map((task, i) => {
        const area = data.areas.find((a) => a.id === task.area_id);
        return (
          <div
            key={task.id}
            className={`task-row ${task.status === "completed" ? "task-completed" : ""}`}
          >
            <button
              className={`task-check ${task.status === "completed" ? "checked" : ""}`}
              disabled={
                pending || !!task.deleted_at || !!task.recurrence_rule_id
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
                    <span
                      className="area-dot"
                      style={{ background: area.color }}
                    />
                    {area.name}
                    <span>·</span>
                  </>
                )}
                {task.estimated_minutes
                  ? `${task.estimated_minutes} min`
                  : task.status.replaceAll("_", " ")}
                {task.scheduling_mode === "eligible" && (
                  <>
                    <span>·</span>
                    <span>Preview eligible</span>
                  </>
                )}
              </span>
            </button>
            {task.priority >= 3 && <Flag className="priority-flag" />}
            <span className={`task-due ${isOverdue(task) ? "overdue" : ""}`}>
              {task.deleted_at
                ? "Deleted"
                : friendlyDate(task.due_date ?? task.due_at)}
            </span>
            {reorder && (
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
                  disabled={i === tasks.length - 1 || pending}
                  onClick={() => move(task, 1)}
                >
                  <ArrowDown size={12} />
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {tasks.length > 8 && (
        <div className="list-pagination">
          <span>
            {Math.min(visible, tasks.length)} of {tasks.length} tasks
          </span>
          {visible < tasks.length ? (
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
