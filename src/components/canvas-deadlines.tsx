"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
type Deadline = {
  canvas_id: string;
  title: string;
  due_at: string;
  synced_at: string;
  conflict: string | null;
  task_id: string | null;
  course_code: string | null;
};
export function CanvasDeadlines() {
  const [now] = useState(() => Date.now());
  const [records, setRecords] = useState<Deadline[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/canvas/deadlines")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok)
          throw Error(
            d.error?.message ?? "Canvas deadlines could not be loaded.",
          );
        if (active) {
          setRecords(d.records);
          setMore(d.has_more);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!records.length && !error) return null;
  return (
    <section className="panel settings-panel">
      <h2>Canvas deadlines</h2>
      <p className="form-hint">
        Previous 7 and next 14 days. These are academic deadlines, separate from
        study sessions. A passed deadline does not establish completion.
      </p>
      {records.slice(0, 6).map((r) => (
        <div className="setting-line" key={r.canvas_id}>
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <strong>
              {r.course_code ? `${r.course_code} · ` : ""}
              {r.title}
            </strong>
            <p>
              {formatInTimeZone(r.due_at, "America/Vancouver", "MMM d, h:mm a")}{" "}
              Vancouver{r.conflict ? " · Reconciliation needed" : ""}
              {now - Date.parse(r.synced_at) > 2 * 3600000
                ? " · Source may be stale"
                : ""}
            </p>
          </div>
        </div>
      ))}
      {(more || records.length > 6) && (
        <p className="small">
          More deadlines are available in Canvas academics.
        </p>
      )}
      <Link className="text-link" href="/canvas-materials">
        View Canvas academics
      </Link>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
