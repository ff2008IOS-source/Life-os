"use client";
import { orderTerms } from "./new-term-setup";
import { SyllabusReference } from "./syllabus-reference";
import { AssessmentTable } from "./assessment-table";
import { possibleAssessmentDuplicates } from "@/lib/academic-display";
import { useCurrentTime } from "./use-current-time";
import { CanvasMaterials } from "./canvas-materials";
import { AssessmentPreparation } from "./assessment-preparation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dueLabel, markPercent } from "@/lib/display";
import { Mark } from "./mark";
import { GradePlanner } from "./grade-planner";
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
  const now = useCurrentTime();
  const [view, setView] = useState(
    initialAssessment
      ? "assessments"
      : [
            "overview",
            "assessments",
            "materials",
            "study",
            "grades",
            "notes",
          ].includes(initialView ?? "")
        ? initialView!
        : "overview",
  );
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [data, setData] = useState<AcademicData>(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [courseId, setCourseId] = useState(initialCourse ?? ""),
    [termChoice, setTerm] = useState<string | null>(null),
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
  // School opens on the newest term that has courses (or the linked course's).
  const newest = orderTerms(data.academic_terms).find((t) =>
    data.courses.some((c) => c.term_id === t.id),
  );
  const linked = data.courses.find((c) => c.id === initialCourse);
  const term =
    termChoice ??
    (linked ? String(linked.term_id ?? "") : String(newest?.id ?? ""));
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
  const pctOf = (a: AcademicRow) =>
    a.dropped
      ? null
      : markPercent(
          a.earned_score as number | null,
          a.maximum_score as number | null,
          a.score_unit === "percent" ? "percent" : "points",
        );
  /**
   * The course's current grade, weighted by its syllabus rules. Never a plain
   * average: without confirmed rules there is no grade to show.
   */
  const averageFor = (courseKey: string) => {
    const course = data.courses.find((c) => c.id === courseKey);
    const rows = data.assessments.filter((a) => a.course_id === courseKey);
    if (
      course?.grading_rules_confirmed === true &&
      course.grading_method !== "unknown"
    ) {
      const weighted = academicGrade(
        String(course.grading_method),
        rows as unknown as GradeAssessment[],
        data.grading_categories.filter(
          (g) => g.course_id === courseKey,
        ) as unknown as GradeCategory[],
        { inventoryComplete: false, rulesVerified: true },
      ).graded_average;
      return weighted;
    }
    return null;
  };
  const nowMs = now.getTime();
  const dueMs = (a: AcademicRow) =>
    a.due_at
      ? Date.parse(String(a.due_at))
      : a.due_date
        ? fromZonedTime(
            String(a.due_date) + "T23:59:00",
            "America/Vancouver",
          ).getTime()
        : null;
  const open = (a: AcademicRow) =>
    !a.dropped &&
    !["submitted", "returned", "excused", "graded"].includes(
      String(a.submission_state),
    ) &&
    typeof a.earned_score !== "number";
  const upcoming = assessments
    .filter((a) => open(a) && (dueMs(a) ?? -1) >= nowMs - 3600000)
    .sort((a, b) => dueMs(a)! - dueMs(b)!);
  const undated = assessments.filter((a) => open(a) && dueMs(a) === null);
  const graded = assessments
    .filter((a) => pctOf(a) !== null)
    .sort((a, b) => (dueMs(b) ?? 0) - (dueMs(a) ?? 0));
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
      <div className="course-switcher">
        <div
          className="course-chips"
          role="radiogroup"
          aria-label="Selected course"
        >
          {courses.map((c) => {
            const avg = averageFor(c.id);
            return (
              <button
                key={c.id}
                role="radio"
                data-course-id={c.id}
                aria-label={`${String(c.code)} · ${String(c.title ?? "")}${avg !== null ? ` · average ${Math.round(avg)}%` : ""}`}
                aria-checked={c.id === selected}
                className={`course-chip ${c.id === selected ? "active" : ""}`}
                onClick={() => setCourseId(c.id)}
              >
                <strong>{String(c.code)}</strong>
                {avg !== null && (
                  <Mark earned={avg} unit="percent" showFraction={false} />
                )}
              </button>
            );
          })}
        </div>
        <div className="course-switcher-actions">
          {data.academic_terms.length > 1 && (
            <select
              aria-label="Academic term"
              value={term}
              onChange={(e) => setTerm(e.currentTarget.value)}
            >
              <option value="">All terms</option>
              {orderTerms(data.academic_terms).map((t) => (
                <option key={t.id} value={t.id}>
                  {String(t.name)}
                </option>
              ))}
            </select>
          )}
          {current && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit({ kind: "courses", record: current })}
            >
              Edit course
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEdit({ kind: "academic_terms" })}
          >
            <Plus size={12} />
            Term
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEdit({ kind: "courses" })}
            disabled={!data.academic_terms.length}
          >
            <Plus size={12} />
            Course
          </Button>
        </div>
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
                ["grades", "Grades"],
                ["study", "Study"],
                ["notes", "Notes"],
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
            {view === "grades" ? (
              <GradePlanner
                course={current}
                assessments={assessments}
                categories={categories}
                onRules={() => {
                  setView("assessments");
                  setTab("categories");
                }}
              />
            ) : view === "notes" ? (
              <section>
                <div className="panel-heading">
                  <h2>Course notes</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEdit({ kind: "courses", record: current })
                    }
                  >
                    Edit notes
                  </Button>
                </div>
                <p className="preserve-lines">
                  {String(current.description || "No notes.")}
                </p>
              </section>
            ) : view === "materials" ? (
              <CanvasMaterials
                key={selected}
                localCourseId={selected}
                embedded
              />
            ) : (
              <>
                <div className="course-stats">
                  <div>
                    <span>Current grade</span>
                    {averageFor(selected!) !== null ? (
                      <strong>
                        <Mark
                          earned={averageFor(selected!)}
                          unit="percent"
                          showFraction={false}
                        />
                      </strong>
                    ) : (
                      <strong>—</strong>
                    )}
                    <small>
                      {current.grading_rules_confirmed === true &&
                      current.grading_method !== "unknown" ? (
                        averageFor(selected!) !== null ? (
                          "Weighted by your syllabus"
                        ) : (
                          "No graded work yet"
                        )
                      ) : (
                        <button
                          type="button"
                          className="td-link"
                          onClick={() => {
                            setView("assessments");
                            setTab("categories");
                          }}
                        >
                          Add syllabus weights
                        </button>
                      )}
                    </small>
                  </div>
                  <div>
                    <span>Graded</span>
                    <strong>
                      {graded.length}
                      <small>
                        {" "}
                        of {assessments.filter((a) => !a.dropped).length}
                      </small>
                    </strong>
                    <small>
                      {summary.graded_weight !== null && weightSupported
                        ? `${Number(summary.graded_weight.toFixed(1))}% of the course weight`
                        : "Course weights not confirmed"}
                    </small>
                  </div>
                  <div>
                    <span>Next due</span>
                    <strong className="course-next">
                      {upcoming[0] ? String(upcoming[0].title) : "Nothing due"}
                    </strong>
                    <small>
                      {upcoming[0]
                        ? dueLabel({
                            due_at: upcoming[0].due_at as string | null,
                            due_date: upcoming[0].due_date as string | null,
                          })
                        : undated.length
                          ? `${undated.length} without a date`
                          : "You’re all caught up"}
                    </small>
                  </div>
                </div>
                {view === "overview" && graded.length > 0 && (
                  <section className="course-results">
                    <h3>Recent results</h3>
                    {graded.slice(0, 6).map((a) => (
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
                          <Mark
                            earned={a.earned_score as number}
                            maximum={a.maximum_score as number | null}
                            unit={
                              a.score_unit === "percent" ? "percent" : "points"
                            }
                          />
                        </span>
                      </button>
                    ))}
                    {graded.length > 6 && (
                      <button
                        className="td-link"
                        onClick={() => {
                          setView("assessments");
                          setTab("assessments");
                        }}
                      >
                        All {graded.length} results
                      </button>
                    )}
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
                    <h3>Coming up</h3>
                    {upcoming.slice(0, 5).map((a) => (
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
                          {dueLabel({
                            due_at: a.due_at as string | null,
                            due_date: a.due_date as string | null,
                          })}
                        </span>
                      </button>
                    ))}
                    {!upcoming.length && assessments.length > 0 && (
                      <p className="small muted">Nothing due soon.</p>
                    )}
                    {undated.length > 0 && (
                      <details className="briefing-detail">
                        <summary>{undated.length} without a due date</summary>
                        {undated.map((a) => (
                          <button
                            className="academic-record-row"
                            key={a.id}
                            onClick={() =>
                              setEdit({ kind: "assessments", record: a })
                            }
                          >
                            <strong>{String(a.title)}</strong>
                            <span className="small muted">Add a date</span>
                          </button>
                        ))}
                      </details>
                    )}
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
                                    ? `${String(row.submission_state ?? "unknown").replaceAll("_", " ")} · ${row.due_date || row.due_at ? dueLabel({ due_at: row.due_at as string | null, due_date: row.due_date as string | null }, now) : "No due date"}`
                                    : tab === "topics"
                                      ? String(row.mastery ?? "unstudied")
                                      : tab === "categories"
                                        ? String(row.aggregation ?? "unknown")
                                        : String(row.notes ?? "")}
                                </small>
                              </div>
                              <span>
                                {tab === "assessments" ? (
                                  row.earned_score === null ? (
                                    "Score unknown"
                                  ) : (
                                    <Mark
                                      earned={row.earned_score as number}
                                      maximum={
                                        row.maximum_score as number | null
                                      }
                                      unit={
                                        row.score_unit === "percent"
                                          ? "percent"
                                          : "points"
                                      }
                                    />
                                  )
                                ) : tab === "categories" ? (
                                  row.weight === null ? (
                                    "Weight unknown"
                                  ) : (
                                    `${row.weight}%`
                                  )
                                ) : tab === "sessions" ? (
                                  row.actual_minutes ? (
                                    `${row.actual_minutes} min`
                                  ) : (
                                    "Duration not recorded"
                                  )
                                ) : (
                                  ""
                                )}
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
