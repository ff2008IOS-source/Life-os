"use client";
import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { AcademicRow } from "./academic-editor";
import {
  assessmentResult,
  submissionLabel,
  possibleAssessmentDuplicates,
} from "@/lib/academic-display";
import { AssessmentPreparation } from "./assessment-preparation";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
export function AssessmentTable({
  rows,
  initialAssessment,
  onEdit,
  onSaved,
}: {
  rows: AcademicRow[];
  initialAssessment?: string;
  onEdit: (row: AcademicRow) => void;
  onSaved: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<AcademicRow | null>(null);
  const [count, setCount] = useState(12);
  const duplicates = possibleAssessmentDuplicates(rows);
  const detail = selected
    ? (rows.find((row) => row.id === selected.id) ?? selected)
    : null;
  const shown = rows.filter(
    (a) =>
      String(a.title).toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "graded"
          ? typeof a.earned_score === "number"
          : filter === "submitted"
            ? a.submission_state === "submitted" ||
              a.submission_state === "returned"
            : filter === "upcoming"
              ? String(a.due_date ?? a.due_at ?? "") >=
                new Date().toISOString().slice(0, 10)
              : a.submission_state === "unknown")),
  );
  function date(a: AcademicRow) {
    return a.due_at
      ? formatInTimeZone(String(a.due_at), "America/Vancouver", "MMM d, h:mm a")
      : a.due_date
        ? formatInTimeZone(
            new Date(String(a.due_date) + "T12:00:00Z"),
            "UTC",
            "MMM d, yyyy",
          )
        : "Not scheduled";
  }
  return (
    <>
      <div className="record-search">
        <label>
          Find an assessment
          <input
            type="search"
            placeholder="Search assignments, exams…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCount(12);
            }}
          />
        </label>
        <label>
          Show
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setCount(12);
            }}
          >
            <option value="all">All assessments</option>
            <option value="upcoming">Upcoming</option>
            <option value="graded">Graded</option>
            <option value="submitted">Submitted / returned</option>
            <option value="unconfirmed">Status to confirm</option>
          </select>
        </label>
      </div>
      {duplicates.length > 0 && (
        <details className="notice">
          <summary>
            {duplicates.length} possible duplicate{" "}
            {duplicates.length === 1 ? "assessment" : "assessments"} to review
          </summary>
          <p className="small">
            Similar titles may refer to the same assessment. Compare the
            syllabus and source before editing; nothing has been merged.
          </p>
          {duplicates.map(([a, b]) => (
            <div className="comparison-pair" key={a + b}>
              {[a, b].map((id) => {
                const row = rows.find((r) => r.id === id)!;
                return (
                  <Button
                    variant="outline"
                    key={id}
                    onClick={() => setSelected(row)}
                  >
                    {String(row.title)} · {assessmentResult(row)}
                  </Button>
                );
              })}
            </div>
          ))}
        </details>
      )}
      <div className="assessment-table-wrap">
        <table className="assessment-table">
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Due</th>
              <th>Submission</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, count).map((a) => (
              <tr
                key={a.id}
                id={`assessment-${a.id}`}
                className={
                  a.id === initialAssessment
                    ? "assessment-highlight"
                    : undefined
                }
              >
                <td>
                  <button
                    className="assessment-title"
                    onClick={() => setSelected(a)}
                  >
                    {String(a.title)}
                  </button>
                  {a.dropped === true && (
                    <span className="badge">Excluded</span>
                  )}
                </td>
                <td data-label="Due">{date(a)}</td>
                <td data-label="Submission">
                  <span
                    className={`status-pill ${["submitted", "returned"].includes(String(a.submission_state)) ? "status-positive" : ""}`}
                  >
                    {submissionLabel(a.submission_state)}
                  </span>
                </td>
                <td data-label="Result" className="assessment-result">
                  {assessmentResult(a)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <p className="calendar-empty">
          {rows.length
            ? "No assessments match your search."
            : "Your assessments will appear here after a sync or when you add one."}
        </p>
      )}
      {shown.length > count && (
        <Button variant="ghost" onClick={() => setCount((n) => n + 12)}>
          Show more assessments ({shown.length - count})
        </Button>
      )}
      {detail && (
        <Modal
          open
          title={String(detail.title)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          description="Assessment details"
        >
          <div className="assessment-details">
            <dl>
              <div>
                <dt>Due</dt>
                <dd>{date(detail)}</dd>
              </div>
              <div>
                <dt>Submission</dt>
                <dd>{submissionLabel(detail.submission_state)}</dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>{assessmentResult(detail)}</dd>
              </div>
              <div>
                <dt>Course weight</dt>
                <dd>
                  {typeof detail.weight === "number"
                    ? `${detail.weight}%`
                    : "Not confirmed from grading rules"}
                </dd>
              </div>
            </dl>
            {detail.notes ? (
              <p className="preserve-lines">{String(detail.notes)}</p>
            ) : null}
            <AssessmentPreparation assessment={detail} onSaved={onSaved} />
            <details className="briefing-detail">
              <summary>Source & verification</summary>
              <p>
                {String(detail.verification_status ?? "unverified").replaceAll(
                  "_",
                  " ",
                )}
              </p>
              <p>
                {String(detail.source_key ?? "No source reference recorded")}
              </p>
              {detail.source_status ? (
                <p>{String(detail.source_status)}</p>
              ) : null}
            </details>
            <Button
              onClick={() => {
                onEdit(detail);
                setSelected(null);
              }}
            >
              Edit assessment
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
