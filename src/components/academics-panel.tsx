"use client";
import { orderTerms, visibleCourses } from "@/lib/course-visibility";
import { SyllabusReference } from "./syllabus-reference";
import { AssessmentTable } from "./assessment-table";
import { useCurrentTime } from "./use-current-time";
import { CanvasMaterials } from "./canvas-materials";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dueLabel, markPercent } from "@/lib/display";
import { Mark } from "./mark";
import { GradePlanner } from "./grade-planner";
import { TopicSuggestions } from "./topic-suggestions";
import {
  byCourseOrder,
  topicSignal,
  type TopicState,
} from "@/lib/topic-finder";
import { gradeScenario } from "@/lib/grade-scenario";
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
  // Overview · Grades · Materials. Older links (?view=assessments, study,
  // notes) land on the tab that now holds that content.
  const [view, setView] = useState(() => {
    const v = initialAssessment ? "assessments" : (initialView ?? "");
    return v === "assessments" || v === "grades"
      ? "grades"
      : v === "materials" || v === "notes"
        ? "materials"
        : "overview";
  });
  const [library, setLibrary] = useState(false);
  const [allTopics, setAllTopics] = useState(false);
  const [studyTab, setStudyTab] = useState<"topics" | "sessions">("topics");
  const [data, setData] = useState<AcademicData>(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [courseId, setCourseId] = useState(initialCourse ?? ""),
    [termChoice, setTerm] = useState<string | null>(null),
    [tab, setTab] = useState<"assessments" | "categories">("assessments"),
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
  const { term, courses } = visibleCourses(
    data.academic_terms,
    data.courses,
    termChoice,
    initialCourse,
  );
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
  // What each final grade would take on the work that's left. Based on the
  // assessments listed in School; nothing is shown without confirmed rules.
  const targets =
    current?.grading_rules_confirmed === true &&
    current.grading_method !== "unknown"
      ? [90, 85, 80, 75].map((goal) => ({
          goal,
          r: gradeScenario(
            String(current.grading_method),
            assessments as unknown as GradeAssessment[],
            categories as unknown as GradeCategory[],
            goal,
            { inventoryComplete: true, rulesVerified: true },
          ),
        }))
      : [];
  const remainingCount = targets.find((t) => t.r.status === "required")?.r;
  // What the evidence says about each topic: a reason line, and a proposed
  // status only when a real result or study session supports it.
  const signals = new Map(
    topics.map((t) => [
      t.id,
      topicSignal({
        topic: {
          id: t.id,
          title: String(t.title),
          mastery: String(t.mastery ?? "unstudied") as TopicState,
          updated_at: t.updated_at as string | undefined,
          notes: String(t.notes ?? ""),
        },
        assessments: assessments.map((a) => ({
          title: String(a.title),
          earned_score:
            typeof a.earned_score === "number" ? a.earned_score : null,
          maximum_score:
            typeof a.maximum_score === "number" ? a.maximum_score : null,
          due_at: a.due_at as string | null,
          due_date: a.due_date as string | null,
        })),
        sessions: sessions.map((s) => ({
          topic_id: (s.topic_id as string | null) ?? null,
          start_at: (s.start_at as string | null) ?? null,
          created_at: s.created_at as string | undefined,
        })),
        now,
      }),
    ]),
  );
  // Course order: week 1, then 2, then 3… (from each topic's notes and
  // source file). Mastered topics drop to the end.
  const sortedTopics = [
    ...byCourseOrder(topics.filter((t) => t.mastery !== "mastered")),
    ...byCourseOrder(topics.filter((t) => t.mastery === "mastered")),
  ];
  const suggestions = byCourseOrder(
    (data.topic_suggestions ?? []).filter((t) => t.course_id === selected),
  );
  async function setMastery(t: AcademicRow, mastery: TopicState) {
    await calendarRequest(`/api/v1/study_topics/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: t.version,
        data: {
          course_id: t.course_id,
          title: t.title,
          mastery,
          notes: t.notes ?? "",
          suggestion_state: "active",
        },
      }),
    });
    await refresh();
  }
  const toReview = topics.filter((t) => t.mastery !== "mastered").length;
  const openGrades = (sub: "assessments" | "categories" = "assessments") => {
    setView("grades");
    setTab(sub);
    setLimit(8);
  };
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
          <p>Start with a term and your first course.</p>
        </div>
      ) : (
        current && (
          <>
            <div className="course-head">
              <div>
                <h2>{String(current.code)}</h2>
                {current.title && current.title !== current.code ? (
                  <p>{String(current.title)}</p>
                ) : null}
              </div>
            </div>
            <div className="tabs course-tabs" aria-label="Course sections">
              {[
                ["overview", "Overview"],
                ["grades", "Grades"],
                ["materials", "Materials"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={`tab ${view === id ? "active" : ""}`}
                  aria-pressed={view === id}
                  onClick={() => {
                    setView(id);
                    setLimit(8);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "overview" && (
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
                    {current.grading_rules_confirmed === true &&
                    current.grading_method !== "unknown" ? (
                      averageFor(selected!) === null && (
                        <small>No graded work yet</small>
                      )
                    ) : (
                      <small>
                        <button
                          type="button"
                          className="td-link"
                          onClick={() => openGrades("categories")}
                        >
                          Add syllabus weights
                        </button>
                      </small>
                    )}
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
                    {current.grading_rules_confirmed === true &&
                      summary.graded_weight !== null && (
                        <small>
                          {Number(summary.graded_weight.toFixed(1))}% of the
                          course
                        </small>
                      )}
                  </div>
                  <div>
                    <span>Next due</span>
                    <strong className="course-next">
                      {upcoming[0] ? String(upcoming[0].title) : "Nothing due"}
                    </strong>
                    {upcoming[0] && (
                      <small>
                        {dueLabel({
                          due_at: upcoming[0].due_at as string | null,
                          due_date: upcoming[0].due_date as string | null,
                        })}
                      </small>
                    )}
                  </div>
                </div>

                {remainingCount && remainingCount.status === "required" && (
                  <section
                    className="course-section"
                    aria-label="What you need"
                  >
                    <div className="course-section-head">
                      <h3>
                        What you need{" "}
                        <span className="course-count">
                          average on the {remainingCount.remaining} remaining{" "}
                          {remainingCount.remaining === 1
                            ? "assessment"
                            : "assessments"}
                        </span>
                      </h3>
                    </div>
                    <ul className="target-list">
                      {targets.map(({ goal, r }) => (
                        <li key={goal}>
                          <span className="target-goal">{goal}% final</span>
                          <span
                            className={`target-need ${r.status === "required" ? (r.percent <= 70 ? "easy" : r.percent <= 90 ? "" : "hard") : "off"}`}
                          >
                            {r.status === "required"
                              ? r.percent < 0.5
                                ? "Already secured"
                                : `${Math.ceil(r.percent)}%`
                              : r.status === "unreachable"
                                ? "Out of reach"
                                : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {remainingCount.excluded > 0 && (
                      <p className="course-note">
                        {remainingCount.excluded} ungraded{" "}
                        {remainingCount.excluded === 1
                          ? "item has"
                          : "items have"}{" "}
                        no listed points and isn’t counted.
                      </p>
                    )}
                  </section>
                )}

                <section
                  className="course-section"
                  aria-label="Topics to review"
                >
                  <div className="course-section-head">
                    <h3>
                      Topics to review{" "}
                      <span className="course-count">
                        {toReview} {toReview === 1 ? "topic" : "topics"}
                      </span>
                    </h3>
                    <div className="segmented">
                      {(
                        [
                          ["topics", "Topics"],
                          ["sessions", "Study log"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          aria-pressed={studyTab === id}
                          className={studyTab === id ? "active" : ""}
                          onClick={() => setStudyTab(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {studyTab === "topics" ? (
                    <>
                      {!toReview && (
                        <p className="course-empty">
                          No topics currently require review.
                        </p>
                      )}
                      <ul className="topic-list">
                        {sortedTopics
                          .slice(0, allTopics ? undefined : 5)
                          .map((t) => {
                            const m = String(t.mastery ?? "unstudied");
                            const level = {
                              unstudied: 0,
                              needs_review: 1,
                              practicing: 2,
                              mastered: 3,
                            }[m];
                            return (
                              <li key={t.id} className={`topic topic-${m}`}>
                                <button
                                  className="topic-title"
                                  onClick={() =>
                                    setEdit({ kind: "study_topics", record: t })
                                  }
                                >
                                  {String(t.title)}
                                  {signals.get(t.id)?.reason && (
                                    <small
                                      className={
                                        signals.get(t.id)?.urgent
                                          ? "topic-why urgent"
                                          : "topic-why"
                                      }
                                    >
                                      {signals.get(t.id)?.reason}
                                    </small>
                                  )}
                                </button>
                                <span
                                  className="topic-meter"
                                  role="img"
                                  aria-label={`${m.replace("_", " ")}`}
                                >
                                  {[1, 2, 3].map((i) => (
                                    <i
                                      key={i}
                                      className={(level ?? 0) >= i ? "on" : ""}
                                    />
                                  ))}
                                </span>
                                <span className="topic-state">
                                  {
                                    {
                                      unstudied: "Not started",
                                      needs_review: "Needs review",
                                      practicing: "Practicing",
                                      mastered: "Mastered",
                                    }[m]
                                  }
                                </span>
                                {signals.get(t.id)?.suggest ? (
                                  <button
                                    className="td-link"
                                    onClick={() =>
                                      void setMastery(
                                        t,
                                        signals.get(t.id)!.suggest!,
                                      )
                                    }
                                  >
                                    Mark{" "}
                                    {signals.get(t.id)!.suggest ===
                                    "needs_review"
                                      ? "needs review"
                                      : "practicing"}
                                  </button>
                                ) : m !== "mastered" ? (
                                  <button
                                    className="td-link"
                                    onClick={() =>
                                      setEdit({ kind: "study_sessions" })
                                    }
                                  >
                                    Continue studying
                                  </button>
                                ) : null}
                              </li>
                            );
                          })}
                      </ul>
                      {sortedTopics.length > 5 && (
                        <button
                          className="td-link"
                          onClick={() => setAllTopics((v) => !v)}
                        >
                          {allTopics
                            ? "Show fewer"
                            : `Show all ${sortedTopics.length}`}
                        </button>
                      )}
                      <TopicSuggestions
                        key={selected}
                        courseId={selected!}
                        suggestions={suggestions}
                        onChanged={refresh}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEdit({ kind: "study_topics" })}
                      >
                        <Plus size={12} />
                        Add topic
                      </Button>
                    </>
                  ) : (
                    <>
                      {!sessions.length && (
                        <p className="course-empty">
                          No study sessions logged.
                        </p>
                      )}
                      <ul className="topic-list">
                        {sessions.slice(0, limit).map((row) => (
                          <li key={row.id} className="topic">
                            <button
                              className="topic-title"
                              onClick={() =>
                                setEdit({ kind: "study_sessions", record: row })
                              }
                            >
                              {row.start_at
                                ? formatInTimeZone(
                                    String(row.start_at),
                                    "America/Vancouver",
                                    "EEE, MMM d · h:mm a",
                                  )
                                : "Study session"}
                            </button>
                            <span className="topic-state">
                              {row.actual_minutes
                                ? `${row.actual_minutes} min`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {sessions.length > limit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLimit((n) => n + 8)}
                        >
                          Show more
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEdit({ kind: "study_sessions" })}
                      >
                        <Plus size={12} />
                        Log a session
                      </Button>
                    </>
                  )}
                </section>

                <section className="course-section" aria-label="Coming up">
                  <div className="course-section-head">
                    <h3>Coming up</h3>
                  </div>
                  {upcoming.slice(0, 5).map((a) => (
                    <button
                      className="academic-record-row"
                      key={a.id}
                      onClick={() =>
                        setEdit({ kind: "assessments", record: a })
                      }
                    >
                      <strong>{String(a.title)}</strong>
                      <span className="course-when">
                        {dueLabel({
                          due_at: a.due_at as string | null,
                          due_date: a.due_date as string | null,
                        })}
                      </span>
                    </button>
                  ))}
                  {undated.map((a) => (
                    <button
                      className="academic-record-row"
                      key={a.id}
                      onClick={() =>
                        setEdit({ kind: "assessments", record: a })
                      }
                    >
                      <strong>{String(a.title)}</strong>
                      <span className="course-when">No due date</span>
                    </button>
                  ))}
                  {!upcoming.length && !undated.length && (
                    <p className="course-empty">
                      {assessments.length
                        ? "Nothing due."
                        : "Assessments appear here after a Canvas sync."}
                    </p>
                  )}
                </section>

                {graded.length > 0 && (
                  <section
                    className="course-section"
                    aria-label="Recent results"
                  >
                    <div className="course-section-head">
                      <h3>Recent results</h3>
                      <button className="td-link" onClick={() => openGrades()}>
                        All grades
                      </button>
                    </div>
                    {graded.slice(0, 5).map((a) => (
                      <button
                        className="academic-record-row"
                        key={a.id}
                        onClick={() => openGrades()}
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
                  </section>
                )}
              </>
            )}

            {view === "grades" && (
              <>
                {current.grading_rules_confirmed === true &&
                current.grading_method !== "unknown" ? (
                  <GradePlanner
                    course={current}
                    assessments={assessments}
                    categories={categories}
                    onRules={() => openGrades("categories")}
                  />
                ) : (
                  <p className="notice">
                    The grading formula is not confirmed. Add the syllabus
                    weights under Grading rules to see your grade.
                  </p>
                )}
                <div className="academic-toolbar">
                  <div className="segmented">
                    {(
                      [
                        ["assessments", "Assessments"],
                        ["categories", "Grading rules"],
                      ] as const
                    ).map(([id, label]) => (
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
                    onClick={() =>
                      setEdit({
                        kind:
                          tab === "assessments"
                            ? "assessments"
                            : "grading_categories",
                      })
                    }
                  >
                    <Plus size={12} />
                    {tab === "assessments" ? "Add assessment" : "Add category"}
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
                    {categories.map((row) => (
                      <button
                        key={row.id}
                        className="academic-record-row"
                        onClick={() =>
                          setEdit({ kind: "grading_categories", record: row })
                        }
                      >
                        <strong>{String(row.name)}</strong>
                        <span>
                          {row.weight === null ? "—" : `${row.weight}%`}
                          {Number(row.drop_lowest_count) > 0
                            ? ` · lowest ${row.drop_lowest_count} dropped`
                            : ""}
                        </span>
                      </button>
                    ))}
                    {!categories.length && (
                      <p className="course-empty">
                        No grading rules yet. Read them from the syllabus in
                        Settings → New term setup, or add them here.
                      </p>
                    )}
                    {summary.warnings.length > 0 && (
                      <p className="course-note">
                        {[...new Set(summary.warnings)].join(" ")}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {view === "materials" && (
              <>
                <div className="academic-toolbar">
                  <div className="segmented">
                    <button
                      aria-pressed={!library}
                      className={!library ? "active" : ""}
                      onClick={() => setLibrary(false)}
                    >
                      This course
                    </button>
                    <button
                      aria-pressed={library}
                      className={library ? "active" : ""}
                      onClick={() => setLibrary(true)}
                    >
                      All Canvas courses
                    </button>
                  </div>
                </div>
                {library ? (
                  <div className="canvas-library-disclosure">
                    <CanvasMaterials embedded />
                  </div>
                ) : (
                  <>
                    <section className="course-section" aria-label="Syllabus">
                      <div className="course-section-head">
                        <h3>Syllabus</h3>
                      </div>
                      <SyllabusReference key={selected} course={selected!} />
                    </section>
                    <CanvasMaterials
                      key={selected}
                      localCourseId={selected}
                      embedded
                    />
                    {current.description ? (
                      <section className="course-section" aria-label="Notes">
                        <div className="course-section-head">
                          <h3>Your notes</h3>
                          <button
                            className="td-link"
                            onClick={() =>
                              setEdit({ kind: "courses", record: current })
                            }
                          >
                            Edit
                          </button>
                        </div>
                        <p className="preserve-lines">
                          {String(current.description)}
                        </p>
                      </section>
                    ) : null}
                  </>
                )}
              </>
            )}
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
