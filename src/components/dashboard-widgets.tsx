"use client";
import { affects } from "@/lib/workspace-change";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  displayedWidgets,
  widgetNames,
  type DashboardLayout,
} from "@/lib/dashboard-layout";
import { goalProgress } from "@/lib/insights";
import { realWorkspace } from "@/lib/real-workspace";
import { availableProject, visibleArea } from "@/lib/visible-areas";
import { useWorkspace } from "./workspace-provider";
import { calendarRequest } from "./use-calendar";
import { QuickCapture, TaskList } from "./task-list";
import { GoogleCalendarPanel } from "./google-calendar-panel";
import { AcademicProgressSummary } from "./academic-progress-summary";
import { WorkSessionsPanel } from "./work-sessions-panel";
import { useFocusSession } from "./focus-session-provider";
import { Button } from "./ui/button";
import type { AcademicData } from "./academic-editor";
import type { BriefingController } from "./use-briefing";
import type { Task } from "@/lib/schemas";
import { reviewAvailability } from "@/lib/temporal-context";
import { useCurrentTime } from "./use-current-time";
import { formatInTimeZone } from "date-fns-tz";
function Card({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <section className="panel dashboard-domain-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        <Link className="text-link" href={href}>
          Open {title} →
        </Link>
      </div>
      {children}
    </section>
  );
}
export function DashboardWidgets({
  layout,
  initialAcademic,
  briefing,
  priorities,
}: {
  layout: DashboardLayout;
  initialAcademic?: AcademicData | null;
  briefing: BriefingController;
  priorities: Task[];
}) {
  const { data: raw } = useWorkspace();
  const data = realWorkspace(raw),
    now = useCurrentTime();
  const shown = displayedWidgets(layout),
    needsAcademics = shown.some((w) =>
      ["academics", "learning"].includes(w.id),
    );
  const [academic, setAcademic] = useState<AcademicData | null>(
      initialAcademic ?? null,
    ),
    [academicError, setAcademicError] = useState("");
  useEffect(() => {
    if (!needsAcademics) return;
    let live = true;
    const load = (event?: Event) => {
      if (
        event &&
        !affects(event, [
          "courses",
          "assessments",
          "study_topics",
          "academic_terms",
          "work",
        ])
      )
        return;
      void calendarRequest<AcademicData>("/api/v1/academics")
        .then((r) => {
          if (live) {
            setAcademic(r);
            setAcademicError("");
          }
        })
        .catch(() => {
          if (live)
            setAcademicError(
              "Course data could not refresh. Open Academics to check your records.",
            );
        });
    };
    if (!initialAcademic) load();
    window.addEventListener("lifeos:changed", load);
    return () => {
      live = false;
      window.removeEventListener("lifeos:changed", load);
    };
  }, [needsAcademics, initialAcademic]);
  const needsCareer = shown.some((w) => ["career", "learning"].includes(w.id));
  // Career skills come from Life OS records (Growth → Career).
  const [skills, setSkills] = useState<
    { id: string; title: string; status: string | null }[] | null
  >(null);
  const [planError, setPlanError] = useState("");
  useEffect(() => {
    if (!needsCareer) return;
    let live = true;
    void calendarRequest<{
      entries: {
        id: string;
        kind: string;
        title: string;
        status: string;
        details: { level?: string };
      }[];
    }>("/api/v1/career/records")
      .then((r) => {
        if (live)
          setSkills(
            r.entries
              .filter((e) => e.kind === "skill")
              .map((e) => ({
                id: e.id,
                title: e.title,
                status:
                  e.details.level ?? (e.status === "unknown" ? null : e.status),
              })),
          );
      })
      .catch(() => {
        if (live)
          setPlanError(
            "Your skills could not load. Open Career to check them.",
          );
      });
    return () => {
      live = false;
    };
  }, [needsCareer]);
  const skillSourceError = "";
  const plans = skills;
  const projects = data.projects.filter(
    (p) =>
      availableProject(p) &&
      p.status === "active" &&
      data.areas.some((a) => a.id === p.area_id && visibleArea(a)),
  );
  const careerArea = data.areas.find((a) => a.slug === "career");
  const career = projects.filter((p) => p.area_id === careerArea?.id);
  const projectArea = data.areas.find((a) => a.slug === "projects");
  const personalProjects = projects.filter(
    (p) => p.area_id === projectArea?.id,
  );
  const upcoming = briefing.data?.assessments
    .filter(
      (a) =>
        !a.dropped &&
        !["submitted", "returned", "excused"].includes(a.submission_state) &&
        (a.due_at
          ? Date.parse(a.due_at) >= now.getTime()
          : !!a.due_date &&
            a.due_date >=
              formatInTimeZone(now, data.profile.timezone, "yyyy-MM-dd")),
    )
    .slice(0, 5);
  const taskOptions = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      !["completed", "cancelled"].includes(t.status) &&
      !t.recurrence_rule_id,
  );
  const focus = useFocusSession();
  const [choice, setChoice] = useState("");
  const projectLinks = (rows: typeof projects) =>
    rows.length ? (
      <ul className="dashboard-records">
        {rows.slice(0, 4).map((p) => (
          <li key={p.id}>
            <Link
              href={`/areas/${data.areas.find((a) => a.id === p.area_id)?.slug ?? "projects"}#project-${p.id}`}
            >
              {p.name}
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">No active projects recorded here.</p>
    );
  const academicContent = academicError ? (
    <p role="alert">{academicError}</p>
  ) : !academic ? (
    <p className="muted">Loading your courses…</p>
  ) : academic.courses.length ? (
    <AcademicProgressSummary provided={academic} />
  ) : (
    <p className="muted">No courses recorded yet.</p>
  );
  const contents: Record<string, ReactNode> = {
    plan: (
      <Card title="Today’s tasks" href="/planner">
        {priorities.length ? (
          <TaskList tasks={priorities} />
        ) : (
          <p className="muted">No next tasks selected. Capture one below.</p>
        )}
        <QuickCapture />
      </Card>
    ),
    schedule: (
      <GoogleCalendarPanel
        start={formatInTimeZone(now, data.profile.timezone, "yyyy-MM-dd")}
        end={new Date(
          Date.parse(
            formatInTimeZone(now, data.profile.timezone, "yyyy-MM-dd") +
              "T12:00Z",
          ) + 86400000,
        )
          .toISOString()
          .slice(0, 10)}
      />
    ),
    upcoming: (
      <Card title="Upcoming" href="/planner">
        {briefing.error ? (
          <p role="alert">Deadlines could not refresh.</p>
        ) : !briefing.data ? (
          <p>Loading deadlines…</p>
        ) : upcoming?.length ? (
          <ul className="dashboard-records">
            {upcoming.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/areas/academics?course=${a.course_id}&assessment=${a.id}`}
                >
                  <strong>
                    {a.course} · {a.title}
                  </strong>
                  <span>
                    {a.due_at
                      ? formatInTimeZone(
                          a.due_at,
                          data.profile.timezone,
                          "EEE, MMM d · h:mm a",
                        )
                      : a.due_date}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No upcoming course deadlines in the loaded planning window.
          </p>
        )}
      </Card>
    ),
    academics: (
      <Card title="Academics" href="/areas/academics">
        {academicContent}
      </Card>
    ),
    career: (
      <Card title="Career" href="/areas/career">
        {projectLinks(career)}
        <p className="small muted">
          {career.length} active projects in your Career area.
        </p>
      </Card>
    ),
    projects: (
      <Card title="Projects" href="/areas/projects">
        {projectLinks(personalProjects)}
        <p className="small muted">
          {personalProjects.length} active projects in your Projects area.
        </p>
      </Card>
    ),
    goals: (
      <Card title="Goals" href="/goals">
        <ul className="dashboard-records">
          {data.goals
            .filter((g) => g.status === "active")
            .slice(0, 4)
            .map((g) => (
              <li key={g.id}>
                <Link href={`/goals#goal-${g.id}`}>
                  {g.title}
                  <span>
                    {goalProgress(g, data.milestones).percent === null
                      ? "Active"
                      : goalProgress(g, data.milestones).label}
                  </span>
                </Link>
              </li>
            ))}
        </ul>
        {!data.goals.some((g) => g.status === "active") && (
          <p className="muted">No active goals recorded.</p>
        )}
      </Card>
    ),
    learning: (
      <Card title="Learning" href="/areas/academics?view=study">
        <h3>Career skills</h3>
        {planError || skillSourceError ? (
          <p role="alert">{planError || skillSourceError}</p>
        ) : !plans ? (
          <p>Loading saved skills…</p>
        ) : skills?.length ? (
          <ul className="dashboard-records">
            {(skills ?? []).slice(0, 4).map((skill) => (
              <li key={skill.id}>
                <Link href="/areas/career">
                  {skill.title}
                  {skill.status ? ` · ${skill.status}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No skills yet. Add one in Career.</p>
        )}
        <p className="small muted">
          Your first few skills; open Career for the full list and evidence.
        </p>
        <h3>Study topics</h3>

        {academicError ? (
          <p role="alert">{academicError}</p>
        ) : !academic ? (
          <p>Loading study topics…</p>
        ) : (
          <>
            {academic.study_topics.length > 0 && (
              <p>
                {
                  academic.study_topics.filter((t) => t.mastery === "mastered")
                    .length
                }{" "}
                of {academic.study_topics.length} topics marked mastered
              </p>
            )}
            <p className="small muted">
              Your recorded study status; this is separate from earned grades.
            </p>
            <ul className="dashboard-records">
              {academic.study_topics
                .filter((t) => t.mastery === "needs_review")
                .slice(0, 4)
                .map((t) => (
                  <li key={String(t.id)}>
                    <Link
                      href={`/areas/academics?course=${t.course_id}&view=study`}
                    >
                      {String(t.title)} · Needs review
                    </Link>
                  </li>
                ))}
            </ul>
            {!academic.study_topics.length && (
              <p className="muted">
                Add study topics in a course to track learning.
              </p>
            )}
          </>
        )}
      </Card>
    ),
    review: (
      <Card title="Weekly review" href="/reviews">
        <p>
          {reviewAvailability(now, data.profile.timezone).open
            ? "Your Sunday review is open."
            : "Your next review opens on Sunday."}
        </p>
        <p className="small muted">
          Reflect on recorded outcomes, then choose next week’s priorities.
        </p>
      </Card>
    ),
    insights: (
      <Card title="Progress" href="/insights">
        {briefing.data ? (
          <>
            <p>
              {briefing.data.weekly.completed_tasks} tasks completed this week
            </p>
            <p className="small muted">
              Recorded completion dates within the current review week.
            </p>
          </>
        ) : (
          <p className="muted">Weekly progress is not available yet.</p>
        )}
      </Card>
    ),
    sessions: (
      <Card title="Work sessions" href="/settings?section=planning">
        <label>
          Choose a task to focus on
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose a task</option>
            {taskOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={
            !choice ||
            !focus ||
            !focus.canStart ||
            focus.busy ||
            !!focus.session
          }
          onClick={() => void focus?.start(choice)}
        >
          Start selected task
        </Button>
        <WorkSessionsPanel compact />
      </Card>
    ),
  };
  return (
    <div
      className="personal-dashboard-grid"
      aria-label="Your dashboard widgets"
    >
      {shown.map((w) => (
        <div
          key={w.id}
          data-widget={w.id}
          className={`dashboard-widget widget-${w.size}`}
          aria-label={`${widgetNames[w.id]} widget`}
        >
          {w.pinned && <span className="widget-pin">Pinned</span>}
          {contents[w.id]}
        </div>
      ))}
    </div>
  );
}
