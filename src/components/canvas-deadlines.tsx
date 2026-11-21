"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  deadlineStatusLabel,
  canvasAssignmentLink,
} from "@/lib/canvas/deadline-status";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
type Deadline = {
  earned_score: number | null;
  maximum_score: number | null;
  canvas_id: string;
  course_canvas_id: string;
  submission_state: string;
  submission_synced_at: string | null;
  late: boolean | null;
  title: string;
  due_at: string;
  synced_at: string;
  conflict: string | null;
  task_id: string | null;
  course_code: string | null;
};
export function CanvasDeadlines() {
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState("");
  const [view, setView] = useState("upcoming"),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(true);
  const [now] = useState(() => Date.now());
  const [records, setRecords] = useState<Deadline[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(
      `/api/canvas/deadlines?view=${view}&page=${page}&search=${encodeURIComponent(search)}&course=${encodeURIComponent(course)}`,
      {
        cache: "no-store",
      },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok)
          throw Error(
            d.error?.message ?? "Canvas deadlines could not be loaded.",
          );
        if (active) {
          setRecords(d.records);
          setMore(d.has_more);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view, page, search, course]);
  return (
    <section className="panel settings-panel">
      <h2>Canvas deadlines</h2>
      <div className="record-search">
        <label>
          Find a deadline
          <input
            type="search"
            value={search}
            placeholder="Search assignments…"
            onChange={(e) => {
              setLoading(true);
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Course code
          <input
            value={course}
            placeholder="All courses"
            onChange={(e) => {
              setLoading(true);
              setCourse(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <div className="career-import-actions" aria-label="Canvas deadline views">
        {[
          ["upcoming", "Upcoming"],
          ["attention", "Needs attention"],
          ["history", "Submitted / graded"],
        ].map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={view === value ? "default" : "outline"}
            aria-pressed={view === value}
            onClick={() => {
              if (value !== view) {
                setLoading(true);
                setView(value);
                setPage(0);
              }
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {loading ? (
        <p role="status" className="small muted">
          Loading deadlines…
        </p>
      ) : !error && !records.length ? (
        <p className="small muted">
          {view === "upcoming"
            ? "No recorded outstanding deadlines in the next 30 days."
            : view === "attention"
              ? "No recorded past-due items needing attention."
              : "No submitted, graded or excused items in this view."}
        </p>
      ) : null}
      {!loading &&
        !error &&
        records.map((r) => (
          <div className="setting-line deadline-record" key={r.canvas_id}>
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong>
                {r.course_code ? `${r.course_code} · ` : ""}
                {r.title}
              </strong>
              <div className="deadline-facts">
                <div>
                  <span className="small muted">Due</span>
                  <p>
                    {formatInTimeZone(
                      r.due_at,
                      "America/Vancouver",
                      "MMM d, h:mm a",
                    )}{" "}
                    Vancouver
                  </p>
                </div>
                <div>
                  <span className="small muted">Submission</span>
                  <p>
                    {deadlineStatusLabel(
                      r.submission_state,
                      Date.parse(r.due_at) < now,
                    )}
                    {r.late ? " · Late" : ""}
                  </p>
                </div>
                <div>
                  <span className="small muted">Result</span>
                  <p>
                    {typeof r.earned_score === "number" &&
                    typeof r.maximum_score === "number"
                      ? `${r.earned_score} / ${r.maximum_score}`
                      : r.submission_state === "submitted"
                        ? "Awaiting grade"
                        : r.submission_state === "graded"
                          ? "View in Canvas"
                          : "Not recorded"}
                  </p>
                </div>
              </div>
              <p className="small muted">
                {r.conflict ? "Source details need review. " : ""}
                {now - Date.parse(r.synced_at) > 2 * 3600000 ||
                !r.submission_synced_at ||
                now - Date.parse(r.submission_synced_at) > 2 * 3600000
                  ? " · Source may be stale"
                  : ""}
              </p>
              {canvasAssignmentLink(r.course_canvas_id, r.canvas_id) && (
                <a
                  className="text-link small"
                  href={canvasAssignmentLink(r.course_canvas_id, r.canvas_id)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open assignment in Canvas
                </a>
              )}
            </div>
          </div>
        ))}
      {(page > 0 || more) && (
        <div className="career-import-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page === 0}
            onClick={() => {
              setLoading(true);
              setPage(page - 1);
            }}
          >
            Previous
          </Button>
          <span className="small">Page {page + 1}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !more}
            onClick={() => {
              setLoading(true);
              setPage(page + 1);
            }}
          >
            Next
          </Button>
        </div>
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
