"use client";
import { useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import type { AcademicRow } from "./academic-editor";

type FindResult = {
  read: number;
  suggested: number;
  remaining: number;
  unreadable: number;
  method?: "ai" | "headings";
  message: string | null;
};

async function post<T>(body: unknown) {
  return calendarRequest<T>("/api/v1/academics/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Topics found in the course's Canvas files. Nothing counts until approved;
 * approved topics start as Not started. Dismissed ones never come back.
 */
export function TopicSuggestions({
  courseId,
  suggestions,
  onChanged,
}: {
  courseId: string;
  suggestions: AcademicRow[];
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<FindResult | null>(null);
  const [error, setError] = useState("");

  async function find() {
    setBusy("find");
    setError("");
    try {
      setResult(
        await post<FindResult>({ action: "find", course_id: courseId }),
      );
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Topics couldn’t be found.");
    } finally {
      setBusy("");
    }
  }
  async function decide(ids: string[], decision: "active" | "dismissed") {
    setBusy(ids.length > 1 ? "all" : ids[0]);
    setError("");
    try {
      await post({ action: "decide", ids, decision });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t save.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="topic-suggest" aria-label="Suggested topics">
      {suggestions.length > 0 && (
        <>
          <div className="course-section-head">
            <h4>
              Found in your materials{" "}
              <span className="course-count">
                {suggestions.length} to check
              </span>
            </h4>
            <button
              className="td-link"
              disabled={!!busy}
              onClick={() =>
                void decide(
                  suggestions.map((s) => s.id),
                  "active",
                )
              }
            >
              Add all
            </button>
          </div>
          <ul className="topic-list">
            {suggestions.map((s) => (
              <li key={s.id} className="topic topic-suggested">
                <span className="topic-title-static">
                  {String(s.title)}
                  {s.notes ? <small>{String(s.notes)}</small> : null}
                </span>
                <button
                  className="td-link"
                  disabled={!!busy}
                  aria-label={`Add ${String(s.title)}`}
                  onClick={() => void decide([s.id], "active")}
                >
                  <Check size={14} aria-hidden /> Add
                </button>
                <button
                  className="td-link td-link-muted"
                  disabled={!!busy}
                  aria-label={`Dismiss ${String(s.title)}`}
                  onClick={() => void decide([s.id], "dismissed")}
                >
                  <X size={14} aria-hidden /> Dismiss
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="topic-find">
        <button
          className="td-btn td-btn-ghost td-btn-sm"
          disabled={!!busy}
          onClick={() => void find()}
        >
          <Sparkles size={14} aria-hidden />
          {busy === "find"
            ? "Reading course files…"
            : result?.remaining
              ? "Read more files"
              : "Find topics in course files"}
        </button>
        {result && (
          <span className="course-note" role="status">
            {result.read
              ? `Read ${result.read} file${result.read === 1 ? "" : "s"} · ${result.suggested} new topic${result.suggested === 1 ? "" : "s"}`
              : "No new files to read"}
            {result.remaining ? ` · ${result.remaining} left` : ""}
            {result.unreadable
              ? ` · ${result.unreadable} couldn’t be read (scanned or too large)`
              : ""}
            {result.method === "headings" && result.read
              ? " · used file headings (AI unavailable)"
              : ""}
            {result.message ? ` · ${result.message}` : ""}
          </span>
        )}
        {error && (
          <span className="course-note" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
