"use client";
import { useState } from "react";
import { Check, Repeat2 } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { friendlyDate, localDate } from "@/lib/dates";
import { TaskEditor } from "./task-editor";
import { EmptyState } from "./task-list";
import type { Task } from "@/lib/schemas";
export function OccurrencesPanel() {
  const { data, request, refresh, notify } = useWorkspace();
  const [editing, setEditing] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const occurrences = data.occurrences
    .filter((o) => {
      const task = data.tasks.find((t) => t.id === o.task_id);
      return (
        task &&
        !task.deleted_at &&
        task.status !== "cancelled" &&
        (history ? o.status === "completed" : o.status === "planned")
      );
    })
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  return (
    <section className="panel">
      <div className="panel-heading">
        <div className="panel-title">
          <Repeat2 />
          <h2>Recurring occurrences</h2>
        </div>
        <button className="text-link" onClick={() => setHistory(!history)}>
          {history ? "Upcoming / missed" : "Completed history"}
        </button>
      </div>
      <p className="panel-description">
        Each recurrence has its own completion state. These dates identify
        occurrences; they are not reserved calendar time.
      </p>
      {occurrences.map((o) => {
        const task = data.tasks.find((t) => t.id === o.task_id)!;
        return (
          <div className="task-row" key={o.id}>
            <button
              className={`task-check ${o.status === "completed" ? "checked" : ""}`}
              aria-label={`${o.status === "completed" ? "Reopen" : "Complete"} ${task.title} on ${o.scheduled_date}`}
              onClick={async () => {
                try {
                  await request(`/api/v1/occurrences/${o.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      version: o.version,
                      status:
                        o.status === "completed" ? "planned" : "completed",
                    }),
                  });
                  await refresh();
                  notify(
                    o.status === "completed"
                      ? "Occurrence reopened"
                      : "Occurrence completed",
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Unable to update occurrence",
                  );
                }
              }}
            >
              {o.status === "completed" && <Check size={12} />}
            </button>
            <button className="task-main" onClick={() => setEditing(task)}>
              <span className="task-title">{task.title}</span>
              <span className="task-meta">Recurring · {o.status}</span>
            </button>
            <span
              className={`task-due ${o.status === "planned" && o.scheduled_date < localDate() ? "overdue" : ""}`}
            >
              {friendlyDate(o.scheduled_date)}
            </span>
          </div>
        );
      })}
      {!occurrences.length && (
        <EmptyState
          icon={Repeat2}
          title={
            history
              ? "No completed occurrences yet"
              : "No recurring occurrences"
          }
          description="Open a saved task and configure a recurrence. Generate the next 90 days on demand."
        />
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {editing && (
        <TaskEditor task={editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
