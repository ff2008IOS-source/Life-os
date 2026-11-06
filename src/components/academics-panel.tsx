"use client";
import { formatInTimeZone } from "date-fns-tz";
import { useState, useEffect, useCallback } from "react";
import { Plus, BookOpen } from "lucide-react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import {
  AcademicEditor,
  type AcademicData,
  type AcademicKind,
  type AcademicRow,
} from "./academic-editor";
import {
  academicGrade,
  type GradeAssessment,
  type GradeCategory,
} from "@/lib/academic-grades";
const empty: AcademicData = {
  academic_terms: [],
  courses: [],
  assessments: [],
  grading_categories: [],
  study_topics: [],
  study_sessions: [],
};
export function AcademicsPanel() {
  const [limit, setLimit] = useState(8);
  const [data, setData] = useState<AcademicData>(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [courseId, setCourseId] = useState(""),
    [term, setTerm] = useState(""),
    [tab, setTab] = useState("assessments"),
    [edit, setEdit] = useState<{
      kind: AcademicKind;
      record?: AcademicRow;
    } | null>(null);
  const refresh = useCallback(async () => {
    setData(await calendarRequest<AcademicData>("/api/v1/academics"));
  }, []);
  useEffect(() => {
    let live = true;
    void calendarRequest<AcademicData>("/api/v1/academics")
      .then((d) => {
        if (live) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  const courses = data.courses.filter((c) => !term || c.term_id === term);
  const current = courses.find((c) => c.id === courseId) ?? courses[0];
  const selected = current?.id;
  const assessments = data.assessments.filter((a) => a.course_id === selected),
    topics = data.study_topics.filter((a) => a.course_id === selected),
    sessions = data.study_sessions.filter((a) => a.course_id === selected),
    categories = data.grading_categories.filter(
      (a) => a.course_id === selected,
    );
  const summary = academicGrade(
    String(current?.grading_method ?? "unknown"),
    assessments as unknown as GradeAssessment[],
    categories as unknown as GradeCategory[],
  );
  const kind: AcademicKind =
    tab === "topics"
      ? "study_topics"
      : tab === "sessions"
        ? "study_sessions"
        : tab === "categories"
          ? "grading_categories"
          : "assessments";
  const rows =
    tab === "topics"
      ? topics
      : tab === "sessions"
        ? sessions
        : tab === "categories"
          ? categories
          : assessments;
  return (
    <section className="academic-workspace">
      <div className="academic-toolbar">
        <div className="inline">
          <BookOpen size={17} />
          <h2>Course workspace</h2>
        </div>
        <div className="inline">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEdit({ kind: "academic_terms" })}
          >
            <Plus size={12} />
            Term
          </Button>
          <Button
            size="sm"
            onClick={() => setEdit({ kind: "courses" })}
            disabled={!data.academic_terms.length}
          >
            <Plus size={12} />
            Course
          </Button>
        </div>
      </div>
      {loading && (
        <p className="muted small" role="status">
          Loading academic records…
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="academic-toolbar">
        <select
          aria-label="Academic term"
          value={term}
          onChange={(e) => setTerm(e.currentTarget.value)}
        >
          <option value="">All terms</option>
          {data.academic_terms.map((t) => (
            <option key={t.id} value={t.id}>
              {String(t.name)}
            </option>
          ))}
        </select>
        {data.academic_terms.find((t) => t.id === term) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setEdit({
                kind: "academic_terms",
                record: data.academic_terms.find((t) => t.id === term),
              })
            }
          >
            Edit term
          </Button>
        )}
        <select
          aria-label="Selected course"
          value={selected ?? ""}
          onChange={(e) => setCourseId(e.currentTarget.value)}
        >
          {!courses.length && <option value="">No courses yet</option>}
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {String(c.code)} ·{" "}
              {String(
                data.academic_terms.find((t) => t.id === c.term_id)?.name ?? "",
              )}
            </option>
          ))}
        </select>
        {current && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEdit({ kind: "courses", record: current })}
          >
            Edit course
          </Button>
        )}
      </div>
      {!current && !loading ? (
        <div className="empty-state compact">
          <BookOpen />
          <h3>Add a term and course</h3>
          <p>
            Term dates may stay blank until confirmed. No grades or assessments
            are assumed.
          </p>
        </div>
      ) : (
        current && (
          <>
            <div className="academic-score-grid">
              <div>
                <span>Recorded-score average</span>
                <strong>
                  {summary.graded_average === null
                    ? "—"
                    : summary.graded_average.toFixed(1) + "%"}
                </strong>
                <small>Only graded work under the selected formula</small>
              </div>
              <div>
                <span>Overall course grade</span>
                <strong>
                  {summary.overall_grade === null
                    ? "Incomplete"
                    : summary.overall_grade.toFixed(1) + "%"}
                </strong>
                <small>Requires complete scores and grading rules</small>
              </div>
              <div>
                <span>Unknown scores</span>
                <strong>{summary.missing_scores}</strong>
                <small>{summary.known_scores} recorded scores</small>
              </div>
            </div>
            {summary.warnings.length > 0 && (
              <p className="muted small academic-note">
                {[...new Set(summary.warnings)].join(" ")}
              </p>
            )}
            <div className="academic-toolbar">
              <div className="segmented">
                {[
                  ["assessments", "Assessments"],
                  ["topics", "Study topics"],
                  ["sessions", "Study log"],
                  ["categories", "Grading rules"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={tab === id}
                    className={tab === id ? "active" : ""}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEdit({ kind })}
              >
                <Plus size={12} />
                Add{" "}
                {tab === "assessments"
                  ? "assessment"
                  : tab === "topics"
                    ? "topic"
                    : tab === "sessions"
                      ? "session"
                      : "category"}
              </Button>
            </div>
            <div className="academic-record-list">
              {rows.slice(0, limit).map((row) => (
                <button
                  className="academic-record-row"
                  key={row.id}
                  onClick={() => setEdit({ kind, record: row })}
                >
                  <div>
                    <strong>
                      {String(
                        row.title ??
                          row.name ??
                          (row.start_at
                            ? formatInTimeZone(
                                String(row.start_at),
                                "America/Vancouver",
                                "MMM d, h:mm a",
                              )
                            : "Study session"),
                      )}
                    </strong>
                    <small>
                      {tab === "assessments"
                        ? `${row.submission_state ?? "unknown"} · ${row.due_date ?? (row.due_at ? String(row.due_at).slice(0, 10) : "No confirmed deadline")}`
                        : tab === "topics"
                          ? String(row.mastery ?? "unstudied")
                          : tab === "categories"
                            ? String(row.aggregation ?? "unknown")
                            : String(row.notes ?? "")}
                    </small>
                  </div>
                  <span>
                    {tab === "assessments"
                      ? row.earned_score === null
                        ? "Score unknown"
                        : `${row.earned_score} / ${row.maximum_score}${row.score_unit === "percent" ? "%" : ""}`
                      : tab === "categories"
                        ? row.weight === null
                          ? "Weight unknown"
                          : `${row.weight}%`
                        : tab === "sessions"
                          ? row.actual_minutes
                            ? `${row.actual_minutes} min`
                            : "Duration not recorded"
                          : ""}
                  </span>
                  {tab === "assessments" && (
                    <span className="badge">
                      {String(
                        row.verification_status ?? "unverified",
                      ).replaceAll("_", " ")}
                    </span>
                  )}
                </button>
              ))}
              {rows.length > limit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit((n) => n + 8)}
                >
                  Show more records ({rows.length - limit} remaining)
                </Button>
              )}
              {!rows.length && (
                <p className="academic-note muted small">
                  No records in this section yet.
                </p>
              )}
            </div>
            <p className="academic-note muted small">
              Study mastery is separate from earned grades. Blank scores never
              count as zero.
            </p>
          </>
        )
      )}
      {edit && (
        <AcademicEditor
          kind={edit.kind}
          record={edit.record}
          courseId={selected}
          data={data}
          onSaved={refresh}
          onClose={() => setEdit(null)}
        />
      )}
    </section>
  );
}
