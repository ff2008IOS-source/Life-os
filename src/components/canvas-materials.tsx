"use client";
import { stamp, dueLabel } from "@/lib/display";
import { useState, useEffect } from "react";
import { FolderClosed } from "lucide-react";
import Link from "next/link";
import {
  groupMaterials,
  friendlyMaterialTitle,
  materialAvailability,
} from "@/lib/material-library";
import { Button } from "./ui/button";
type Data = {
  mapped_course?: string | null;
  mapping_status?:
    "linked" | "library" | "unlinked" | "ambiguous" | "needs_review";
  courses: { id: string; name: string }[];
  courses_truncated: boolean;
  has_more: boolean;
  library_limited?: boolean;
  records: {
    id: string;
    type: string;
    module?: string | null;
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
/** Week number from a title or module name ("Week 10", "W10", "wk 3"). */
export function weekOf(text: string): number | null {
  const m = text.match(/\b(?:week|wk|w)\s*0?(\d{1,2})\b/i);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 16 ? n : null;
}

export function CanvasMaterials({
  localCourseId,
  embedded = false,
  termStart = null,
  suggestions = [],
}: {
  localCourseId?: string;
  embedded?: boolean;
  /** First day of the term (yyyy-MM-dd), for "this week" on the term line. */
  termStart?: string | null;
  /** Quick searches shown under the search box. */
  suggestions?: string[];
} = {}) {
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [reading, setReading] = useState(false);
  const [data, setData] = useState<Data | null>(null),
    [course, setCourse] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(
      `/api/canvas/materials?library=true&page=${page}${localCourseId ? `&local_course=${encodeURIComponent(localCourseId)}` : course ? `&course=${course}` : ""}`,
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
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [localCourseId, course, page, revision]);
  return (
    <section className={embedded ? "course-materials" : "panel settings-panel"}>
      <div className="academic-toolbar">
        <h3>{localCourseId ? "Course materials" : "Canvas library"}</h3>
      </div>
      {loading && <p role="status">Loading course materials…</p>}
      {data?.mapping_status === "unlinked" && (
        <p className="notice">
          This course is not linked to a Canvas course yet. Connect and sync
          Canvas in Settings, or browse the separate Canvas library below.
        </p>
      )}
      {data?.mapping_status === "needs_review" && (
        <p className="notice">
          This course’s Canvas link needs review before its materials can be
          shown. Check the Canvas connection in Settings.
        </p>
      )}
      {data?.mapping_status === "ambiguous" && (
        <p className="notice">
          More than one Canvas course is linked here. Review the connection
          before using these materials.
        </p>
      )}
      {!localCourseId && (
        <>
          <label>
            Canvas course
            <select
              value={course}
              onChange={(e) => {
                setLoading(true);
                setError("");
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
        </>
      )}
      <label className="library-search">
        Find course material
        <input
          type="search"
          placeholder="Search readings, lectures, tutorials…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {suggestions.length > 0 && (
        <div className="material-suggest" aria-label="Suggested searches">
          {suggestions.slice(0, 5).map((t) => (
            <button
              key={t}
              type="button"
              className={query === t ? "active" : ""}
              onClick={() => setQuery(query === t ? "" : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="materials-actions">
        <Button
          variant="outline"
          disabled={
            reading ||
            Boolean(error) ||
            loading ||
            (Boolean(localCourseId) && !data?.mapped_course)
          }
          onClick={async () => {
            setReading(true);
            setError("");
            try {
              const r = await fetch("/api/canvas/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  course: data?.mapped_course || course || null,
                }),
              });
              const d = await r.json();
              if (!r.ok)
                throw Error(d.error?.message ?? "File reading failed.");
              setLoading(true);
              setRevision((v) => v + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setReading(false);
            }
          }}
        >
          {reading ? "Reading course files…" : "Make files searchable"}
        </Button>
      </div>
      {data?.library_limited && (
        <p className="notice">
          Showing 999 materials. Search applies to these loaded items; use Next
          for the remaining resources.
        </p>
      )}
      {data?.courses_truncated && <p>Course list exceeds this view’s limit.</p>}
      {!loading && !error && !query && (
        <TermLine
          records={(data?.records ?? []).filter(
            (r) => !["module", "module_item", "course"].includes(r.type),
          )}
          termStart={termStart}
          open={openWeek}
          onOpen={setOpenWeek}
        />
      )}
      {!loading &&
        !error &&
        groupMaterials(data?.records ?? [], query)
          .filter((f) => f.title === "Readings" && f.records.length > 0)
          .map((folder) => (
            <section
              key={folder.key}
              className="material-covers"
              aria-label="Readings"
            >
              <h4>Readings</h4>
              <ul>
                {folder.records.map((r, i) => (
                  <li key={r.type + r.id}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`cover cover-${i % 5}`}
                    >
                      <span>{friendlyMaterialTitle(r.title)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      {!loading &&
        !error &&
        groupMaterials(data?.records ?? [], query)
          .filter((f) => query || f.title !== "Readings")
          .map((folder) => (
            <details
              className="material-folder"
              key={folder.key}
              open={Boolean(query) || folder.title.includes("Syllabus")}
            >
              <summary>
                <FolderClosed
                  size={16}
                  className="material-folder-icon"
                  aria-hidden="true"
                />
                <span>{folder.title}</span>
                <span className="badge">{folder.records.length}</span>
              </summary>
              <div className="material-folder-content">
                {folder.records.map((r) => (
                  <details key={r.type + r.id} className="setting-line">
                    <summary>
                      <span>{friendlyMaterialTitle(r.title)}</span>
                      <span className="badge">
                        {materialAvailability(r.content_status, r.text)}
                      </span>
                    </summary>
                    <div>
                      <p className="small muted tech-detail">
                        Original name: {r.title}
                      </p>
                      <p className="form-hint tech-detail">
                        Retrieved {stamp(r.synced_at)} ·{" "}
                        {r.content_status === "Retrieved Canvas record"
                          ? "Synced from Canvas"
                          : r.content_status}
                      </p>
                      {r.due_at && <p>Canvas deadline: {dueLabel(r.due_at)}</p>}
                      {r.score !== null && (
                        <p>
                          Canvas score: {r.score}
                          {r.maximum !== null
                            ? ` / ${r.maximum}`
                            : " (maximum not available)"}
                        </p>
                      )}
                      {r.type === "assignment" && (
                        <p>
                          Status: {r.state?.replaceAll("_", " ") ?? "Unknown"}
                        </p>
                      )}
                      <p
                        className="small"
                        style={{
                          overflowWrap: "anywhere",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {r.text || "Text isn’t available for this item yet."}
                      </p>
                      <details className="tech-detail">
                        <summary>Source details</summary>
                        {Object.entries(r.facts ?? {}).map(([k, v]) => (
                          <p
                            key={k}
                            className="small"
                            style={{ overflowWrap: "anywhere" }}
                          >
                            {k}: {v}
                          </p>
                        ))}
                      </details>
                      {r.type === "assignment" && (
                        <Button
                          onClick={async () => {
                            try {
                              const response = await fetch(
                                "/api/canvas/tasks",
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ id: r.id }),
                                },
                              );
                              const body = await response.json();
                              if (!response.ok)
                                throw Error(body.error?.message);
                              setError("");
                              setMessage(
                                "Task ready in Planner. Add an estimate when you’re ready to plan a session.",
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
                        Open in Canvas
                      </a>
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
      {!loading &&
        !error &&
        query &&
        !groupMaterials(data?.records ?? [], query).length && (
          <p className="calendar-empty">No materials match your search.</p>
        )}
      {!loading &&
        !error &&
        data?.mapping_status !== "unlinked" &&
        data?.mapping_status !== "ambiguous" &&
        data?.mapping_status !== "needs_review" &&
        !data?.records.length && (
          <p>No materials to show yet. Sync Canvas to check for updates.</p>
        )}
      {message && (
        <p role="status">
          {message} <Link href="/planner?section=tasks">Open Planner</Link>
        </p>
      )}
      {(page > 0 || data?.has_more) && (
        <div className="career-import-actions">
          <Button
            disabled={loading || !page}
            onClick={() => {
              setLoading(true);
              setPage((p) => p - 1);
            }}
          >
            Previous
          </Button>
          <Button
            disabled={loading || !data?.has_more}
            onClick={() => {
              setLoading(true);
              setPage((p) => p + 1);
            }}
          >
            Next
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="error-message">
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              setError("");
              setRevision((v) => v + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
    </section>
  );
}

type TermRecord = {
  id: string;
  type: string;
  title: string;
  module?: string | null;
  url: string;
};
/**
 * Lectures on the term line: one dot per week, filled where course files
 * belong to that week; "This week" from the term's start date.
 */
function TermLine({
  records,
  termStart,
  open,
  onOpen,
}: {
  records: TermRecord[];
  termStart: string | null;
  open: number | null;
  onOpen: (w: number | null) => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const byWeek = new Map<number, TermRecord[]>();
  for (const r of records) {
    const w = weekOf(r.title) ?? weekOf(r.module ?? "");
    if (!w) continue;
    byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
  }
  if (byWeek.size < 2) return null;
  const now =
    termStart && nowMs
      ? Math.floor(
          (nowMs - Date.parse(termStart + "T12:00:00Z")) / (7 * 86400000),
        ) + 1
      : null;
  const last = Math.max(13, ...byWeek.keys());
  const weeks = Array.from({ length: last }, (_, i) => i + 1);
  const shown = open ? (byWeek.get(open) ?? []) : [];
  return (
    <section className="term-line" aria-label="Lectures by week">
      <h4>
        Lectures by week{" "}
        <span className="course-count">
          {[...byWeek.values()].reduce((n, v) => n + v.length, 0)} files
        </span>
      </h4>
      <ol>
        {weeks.map((w) => {
          const has = byWeek.has(w);
          return (
            <li
              key={w}
              className={`${has ? "has" : ""} ${w === now ? "now" : ""} ${w === open ? "open" : ""}`}
            >
              {w === now && <span className="term-now">This week</span>}
              <button
                type="button"
                disabled={!has}
                aria-pressed={w === open}
                aria-label={`Week ${w}${has ? `, ${byWeek.get(w)!.length} files` : ", no files"}${w === now ? ", this week" : ""}`}
                onClick={() => onOpen(w === open ? null : w)}
              />
              <span aria-hidden>{w}</span>
            </li>
          );
        })}
      </ol>
      {open && shown.length > 0 && (
        <ul className="term-files">
          {shown.map((r) => (
            <li key={r.type + r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {friendlyMaterialTitle(r.title)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
