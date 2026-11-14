"use client";
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
export function CanvasMaterials({
  localCourseId,
  embedded = false,
}: { localCourseId?: string; embedded?: boolean } = {}) {
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
        <Link href="/canvas-connect" className="text-link">
          Connection
        </Link>
      </div>
      <p className="small muted">
        Your imported readings, slides and course resources.
      </p>
      <details className="briefing-detail">
        <summary>About these materials</summary>
        <p>
          Only material successfully retrieved from Canvas appears here.
          Restricted files and scanned pages may be unavailable. This list does
          not confirm complete exam coverage.
        </p>
      </details>
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
      <details className="briefing-detail">
        <summary>Reading & file preparation</summary>
        <p className="small muted">
          Prepare supported documents to make their text available for studying.
          Files still open in Canvas while preparation is pending.
        </p>
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
          {reading ? "Reading course files…" : "Prepare available files"}
        </Button>
      </details>
      {data?.library_limited && (
        <p className="notice">
          Showing 999 materials. Search applies to these loaded items; use Next
          for the remaining resources.
        </p>
      )}
      {data?.courses_truncated && <p>Course list exceeds this view’s limit.</p>}
      {!loading &&
        !error &&
        groupMaterials(data?.records ?? [], query).map((folder) => (
          <details
            className="material-folder"
            key={folder.key}
            open={Boolean(query) || folder.title.includes("Syllabus")}
          >
            <summary>
              <span>{folder.title}</span>
              <span className="badge">{folder.records.length}</span>
              {folder.suggested && <small>Suggested group</small>}
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
                    <p className="small muted">Original name: {r.title}</p>
                    <p className="form-hint">
                      Retrieved {new Date(r.synced_at).toLocaleString()} ·{" "}
                      {r.content_status === "Retrieved Canvas record"
                        ? "Synced from Canvas"
                        : r.content_status}
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
                    <details>
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
                            const response = await fetch("/api/canvas/tasks", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: r.id }),
                            });
                            const body = await response.json();
                            if (!response.ok) throw Error(body.error?.message);
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
