"use client";
import { SyllabusReference } from "./syllabus-reference";
import { AssessmentTable } from "./assessment-table";
import {
  standingLabel,
  assessmentResult,
  possibleAssessmentDuplicates,
} from "@/lib/academic-display";
import { CanvasMaterials } from "./canvas-materials";
import { AssessmentPreparation } from "./assessment-preparation";
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
export function AcademicsPanel({
  initialCourse,
  initialAssessment,
  initialView,
}: {
  initialCourse?: string;
  initialAssessment?: string;
  initialView?: string;
} = {}) {
  const [limit, setLimit] = useState(8);
  const [view, setView] = useState(
    initialAssessment
      ? "assessments"
      : ["overview", "assessments", "materials", "study"].includes(
            initialView ?? "",
          )
        ? initialView!
        : "overview",
  );
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [data, setData] = useState<AcademicData>(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [courseId, setCourseId] = useState(initialCourse ?? ""),
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
  const assessments = data.assessments
      .filter((a) => a.course_id === selected)
      .sort(
        (a, b) =>
          Number(b.id === initialAssessment) -
          Number(a.id === initialAssessment),
      ),
    topics = data.study_topics.filter((a) => a.course_id === selected),
    sessions = data.study_sessions.filter((a) => a.course_id === selected),
    categories = data.grading_categories.filter(
      (a) => a.course_id === selected,
    );
  const summary = academicGrade(
    String(current?.grading_method ?? "unknown"),
    assessments as unknown as GradeAssessment[],
    categories as unknown as GradeCategory[],
    {
      inventoryComplete: current?.inventory_confirmed === true,
      rulesVerified: current?.grading_rules_confirmed === true,
    },
  );
  const standingSupported =
    current?.grading_rules_confirmed === true &&
    possibleAssessmentDuplicates(assessments).length === 0 &&
    assessments
      .filter((a) => !a.dropped && typeof a.earned_score === "number")
      .every((a) =>
        ["verified", "user_confirmed"].includes(String(a.verification_status)),
      );
  const weightSupported =
    standingSupported && current?.grading_method === "assessment_weights";
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
          Loading your courses…
        </p>
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
              void refresh()
                .catch((e) =>
                  setError(
                    e instanceof Error ? e.message : "Courses could not load.",
                  ),
                )
                .finally(() => setLoading(false));
            }}
          >
            Try again
          </Button>
        </div>
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
      {!current && !loading && !error ? (
        <div className="empty-state compact">
          <BookOpen />
          <h3>Add a term and course</h3>
          <p>
            Start with a term and your first course. You can add the details
            later.
          </p>
        </div>
      ) : (
        current && (
          <>
            <div className="tabs course-tabs" aria-label="Course sections">
              {[
                ["overview", "Overview"],
                ["assessments", "Assessments"],
                ["materials", "Materials"],
                ["study", "Study"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={`tab ${view === id ? "active" : ""}`}
                  aria-pressed={view === id}
                  onClick={() => {
                    setView(id);
                    setTab(id === "study" ? "topics" : "assessments");
                    setLimit(8);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "materials" ? (
              <CanvasMaterials
                key={selected}
                localCourseId={selected}
                embedded
              />
            ) : (
              <>
                <div className="academic-score-grid">
                  <div>
                    <span>
                      {standingLabel(summary, standingSupported).title}
                    </span>
                    <strong>
                      {standingLabel(summary, standingSupported).value}
                    </strong>
                    <small>
                      {summary.overall_grade !== null
                        ? "All confirmed assessments"
                        : summary.graded_average !== null && standingSupported
                          ? "Based on graded work so far"
                          : "Recorded assessment results"}
                    </small>
                  </div>
                  <div>
                    <span>Graded course weight</span>
                    <strong>
                      {summary.graded_weight !== null && weightSupported
                        ? `${Number(summary.graded_weight.toFixed(1))}%`
                        : "To confirm"}
                    </strong>
                    <small>
                      {summary.graded_weight !== null && weightSupported
                        ? "Weight represented by current results"
                        : "Check syllabus grading rules"}
                    </small>
                  </div>
                  <div>
                    <span>Results pending</span>
                    <strong>{summary.missing_scores}</strong>
                    <small>
                      Of {summary.known_scores + summary.missing_scores}{" "}
                      included assessments
                    </small>
                  </div>
                </div>
                {view === "overview" && summary.known_scores > 0 && (
                  <section className="course-results">
                    <h3>Recorded results</h3>
                    {assessments
                      .filter((a) => typeof a.earned_score === "number")
                      .slice(0, 3)
                      .map((a) => (
                        <button
                          className="academic-record-row"
                          key={a.id}
                          onClick={() => {
                            setView("assessments");
                            setTab("assessments");
                          }}
                        >
                          <strong>{String(a.title)}</strong>
                          <span className="assessment-result">
                            {assessmentResult(a)}
                          </span>
                        </button>
                      ))}
                  </section>
                )}
                <details
                  className="briefing-detail"
                  onToggle={(e) => setSyllabusOpen(e.currentTarget.open)}
                >
                  <summary>Grading details & syllabus</summary>
                  <p className="small">
                    {current.grading_rules_confirmed === true
                      ? "Grading rules confirmed."
                      : "Confirm the syllabus grading rules to calculate your current standing."}{" "}
                    Missing results are left out, never counted as zero.
                  </p>
                  {summary.warnings.length > 0 && (
                    <p className="small muted">
                      {[...new Set(summary.warnings)].join(" ")}
                    </p>
                  )}
                  {syllabusOpen && selected && (
                    <SyllabusReference key={selected} course={selected} />
                  )}
                  <div className="inline">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setView("materials");
                      }}
                    >
                      Open syllabus & materials
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setView("assessments");
                        setTab("categories");
                      }}
                    >
                      Review grading rules
                    </Button>
                  </div>
                </details>
                {view === "overview" ? (
                  <div className="course-overview">
                    <h3>Assessments to review</h3>
                    {assessments
                      .filter(
                        (a) =>
                          !a.dropped &&
                          !["submitted", "returned", "excused"].includes(
                            String(a.submission_state),
                          ),
                      )
                      .slice(0, 3)
                      .map((a) => (
                        <button
                          className="academic-record-row"
                          key={a.id}
                          onClick={() => {
                            setView("assessments");
                            setTab("assessments");
                            setEdit({ kind: "assessments", record: a });
                          }}
                        >
                          <strong>{String(a.title)}</strong>
                          <span className="small muted">
                            {a.due_date
                              ? String(a.due_date)
                              : a.due_at
                                ? formatInTimeZone(
                                    String(a.due_at),
                                    "America/Vancouver",
                                    "MMM d, h:mm a",
                                  )
                                : "Deadline not set"}
                          </span>
                        </button>
                      ))}
                    {!assessments.length && (
                      <p>
                        Your assessments will appear here after a sync or when
                        you add one.
                      </p>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setView("assessments");
                        setTab("assessments");
                      }}
                    >
                      View assessments
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="academic-toolbar">
                      <div className="segmented">
                        {[
                          ["assessments", "Assessments"],
                          ["topics", "Study topics"],
                          ["sessions", "Study log"],
                          ["categories", "Grading rules"],
                        ]
                          .filter(([id]) =>
                            view === "study"
                              ? ["topics", "sessions"].includes(id)
                              : ["assessments", "categories"].includes(id),
                          )
                          .map(([id, label]) => (
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
                    {tab === "assessments" ? (
                      <AssessmentTable
                        rows={assessments}
                        initialAssessment={initialAssessment}
                        onEdit={(record) =>
                          setEdit({ kind: "assessments", record })
                        }
                        onSaved={refresh}
                      />
                    ) : (
                      <div className="academic-record-list">
                        {rows.slice(0, limit).map((row) => (
                          <div
                            key={row.id}
                            id={`assessment-${row.id}`}
                            className={
                              row.id === initialAssessment
                                ? "assessment-highlight"
                                : undefined
                            }
                          >
                            <button
                              className="academic-record-row"
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
                            {tab === "assessments" && (
                              <AssessmentPreparation
                                assessment={row}
                                onSaved={refresh}
                              />
                            )}
                          </div>
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
                    )}
                  </>
                )}
              </>
            )}
          </>
        )
      )}
      <details
        className="canvas-library-disclosure"
        onToggle={(e) => setLibraryOpen(e.currentTarget.open)}
      >
        <summary>Browse other Canvas courses</summary>
        <p className="small muted">
          This library includes Canvas courses that may not be linked to the
          selected course.
        </p>
        {libraryOpen && <CanvasMaterials embedded />}
      </details>
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
