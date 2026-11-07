"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
type Data = {
  courses: { id: string; name: string }[];
  courses_truncated: boolean;
  has_more: boolean;
  records: {
    id: string;
    type: string;
    course: string | null;
    title: string;
    text: string;
    due_at: string | null;
    score: number | null;
    maximum: number | null;
    state: string | null;
    synced_at: string;
    content_status: string;
    facts: Record<string, string>;
    url: string;
  }[];
};
export function CanvasMaterials() {
  const [data, setData] = useState<Data | null>(null),
    [course, setCourse] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(
      `/api/canvas/materials?page=${page}${course ? `&course=${course}` : ""}`,
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message);
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [course, page]);
  return (
    <section className="panel settings-panel">
      <div className="academic-toolbar">
        <h1>Canvas academics</h1>
        <Link href="/canvas-connect" className="text-link">
          Connection
        </Link>
      </div>
      <p className="small muted">
        Canvas snapshots show what was retrieved, not complete course or exam
        coverage. Files are metadata only. Check source freshness before relying
        on a deadline or grade.
      </p>
      <label>
        Canvas course
        <select
          value={course}
          onChange={(e) => {
            setCourse(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All courses</option>
          {data?.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {data?.courses_truncated && <p>Course list exceeds this view’s limit.</p>}
      {data?.records.map((r) => (
        <details key={r.type + r.id} className="setting-line">
          <summary>
            {r.title} <span className="badge">{r.type}</span>
          </summary>
          <div>
            <p className="form-hint">
              Retrieved {new Date(r.synced_at).toLocaleString()} ·{" "}
              {r.content_status}
            </p>
            {r.due_at && (
              <p>
                Canvas deadline:{" "}
                {new Date(r.due_at).toLocaleString("en-CA", {
                  timeZone: "America/Vancouver",
                })}{" "}
                Vancouver
              </p>
            )}
            {r.score !== null && (
              <p>
                Canvas score: {r.score}
                {r.maximum !== null
                  ? ` / ${r.maximum}`
                  : " (maximum not available)"}
              </p>
            )}
            <p>Submission/record state: {r.state ?? "Unknown"}</p>
            <p
              className="small"
              style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
            >
              {r.text || "No text content retrieved."}
            </p>
            {Object.entries(r.facts ?? {}).map(([k, v]) => (
              <p key={k} className="small" style={{ overflowWrap: "anywhere" }}>
                {k}: {v}
              </p>
            ))}
            {r.type === "assignment" && (
              <Button
                onClick={async () => {
                  try {
                    const response = await fetch("/api/canvas/tasks", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: r.id }),
                    });
                    const body = await response.json();
                    if (!response.ok) throw Error(body.error?.message);
                    setError("");
                    alert(
                      "Linked task is available in Planner. Add an estimate before scheduling.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Add to Planner
              </Button>
            )}
            <a
              className="text-link"
              href={r.url}
              target="_blank"
              rel="noreferrer"
            >
              Open Canvas course
            </a>
          </div>
        </details>
      ))}
      {!data?.records.length && <p>No imported records on this page.</p>}
      <div className="career-import-actions">
        <Button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button
          disabled={!data?.has_more}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
