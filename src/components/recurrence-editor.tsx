"use client";
import { useState } from "react";
import { Repeat2, Check } from "lucide-react";
import type { Task } from "@/lib/schemas";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { localDate, friendlyDate } from "@/lib/dates";
export function RecurrenceEditor({ task }: { task: Task }) {
  const { data, request, refresh, notify } = useWorkspace();
  const rule = data.recurrences.find((r) => r.id === task.recurrence_rule_id);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [rrule, setRrule] = useState(rule?.rrule ?? "FREQ=WEEKLY");
  const [starts, setStarts] = useState(rule?.start_date ?? localDate());
  const [ends, setEnds] = useState(rule?.end_date ?? "");
  const occurrences = data.occurrences
    .filter((o) => o.task_id === task.id)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  return (
    <details>
      <summary className="text-link">
        <Repeat2 size={13} />
        Recurring occurrences {rule ? "· configured" : "· optional"}
      </summary>
      <p className="form-hint" style={{ marginTop: 10 }}>
        Generates the next 90 days on demand. Each occurrence has its own
        completion history. No background generation or recurring calendar
        writes.
      </p>
      <label style={{ marginTop: 12 }}>
        Date-only RRULE
        <input
          name="recurrence_rrule"
          form="recurrence-config"
          value={rrule}
          onChange={(e) => setRrule(e.target.value)}
          placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
        />
      </label>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label>
          Starts
          <input
            name="recurrence_start"
            form="recurrence-config"
            type="date"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label>
          Ends (optional)
          <input
            name="recurrence_end"
            form="recurrence-config"
            type="date"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
          />
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        style={{ marginTop: 12 }}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            await request(`/api/v1/tasks/${task.id}/recurrence`, {
              method: "POST",
              body: JSON.stringify({
                version: task.version,
                rrule: rrule,
                start_date: starts,
                end_date: ends || null,
              }),
            });
            await refresh();
            notify(
              "Recurring occurrences generated. Close and reopen to edit the updated task.",
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Recurrence failed");
          } finally {
            setPending(false);
          }
        }}
      >
        Generate / update occurrences
      </Button>
      {occurrences.slice(0, 30).map((o) => (
        <div className="flex-between" key={o.id} style={{ marginTop: 12 }}>
          <span className="small muted">
            {friendlyDate(o.scheduled_date)} · {o.status}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await request(`/api/v1/occurrences/${o.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    version: o.version,
                    status: o.status === "completed" ? "planned" : "completed",
                  }),
                });
                await refresh();
                notify(
                  o.status === "completed"
                    ? "Occurrence reopened"
                    : "Occurrence completed",
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Update failed");
              }
            }}
          >
            {o.status === "completed" ? (
              "Reopen"
            ) : (
              <>
                <Check size={12} />
                Complete
              </>
            )}
          </Button>
        </div>
      ))}
      {occurrences.length > 30 && (
        <p className="form-hint">
          Showing the first 30 of {occurrences.length} stored occurrences. Full
          history is included in export.
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </details>
  );
}
