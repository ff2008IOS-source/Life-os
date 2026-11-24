"use client";
import { useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { Button } from "./ui/button";
type Source = {
  id: string;
  type: string;
  title: string;
  text: string;
  url: string;
  synced_at: string;
};
/** Shows source evidence beside grading rules; no inferred weights are silently applied. */
export function SyllabusReference({ course }: { course: string }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void calendarRequest<{ records: Source[] }>(
      `/api/canvas/materials?local_course=${encodeURIComponent(course)}&library=true&syllabus=true`,
    )
      .then((data) => {
        if (live)
          setSources(
            data.records.filter(
              (s) =>
                /syllabus|outline/i.test(s.title) ||
                (s.type === "course" && s.text),
            ),
          );
      })
      .catch((e) => {
        if (live)
          setError(e instanceof Error ? e.message : "Syllabus could not load");
      });
    return () => {
      live = false;
    };
  }, [course, revision]);
  return (
    <section className="syllabus-reference">
      {error ? (
        <p role="alert">
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError("");
              setRevision((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </p>
      ) : sources === null ? (
        <p role="status">Finding your course syllabus…</p>
      ) : !sources.length ? (
        <p className="small muted">
          No linked syllabus is available yet. Add or sync the course syllabus
          before confirming grading rules.
        </p>
      ) : (
        sources.map((source) => (
          <details key={source.id} className="briefing-detail">
            <summary>{source.title}</summary>
            <p className="small preserve-lines">
              {(source.text.match(/grading[\s\S]{0,2200}/i)?.[0] ??
                source.text) ||
                "Open the syllabus in Canvas, or prepare its text in Materials."}
            </p>
            <a
              className="text-link"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              Open source in Canvas
            </a>
          </details>
        ))
      )}
    </section>
  );
}
