"use client";
import type { SavedPlans } from "@/lib/services/saved-plans";
import type { LiveBriefing } from "@/lib/briefing-server";
import type { AcademicData } from "./academic-editor";
import { DashboardCustomizer } from "./dashboard-customizer";
import dynamic from "next/dynamic";
import { migrateLayout } from "@/lib/dashboard-layout";
import { reviewAvailability } from "@/lib/temporal-context";
import { SyncHealth } from "./sync-health";
import { useCurrentTime } from "./use-current-time";
import { realWorkspace } from "@/lib/real-workspace";
import Link from "next/link";
import { AttentionHistory } from "./attention-history";
import { BriefingPanel } from "./briefing-page";
import { useBriefing } from "./use-briefing";
import { todayPriorities, personalGreeting } from "@/lib/today-priorities";

import { GoogleCalendarPanel } from "./google-calendar-panel";
import {
  CalendarDays,
  CheckCheck,
  ArrowUpRight,
  ArrowRight,
  Flag,
  Target,
  Clock3,
  BookOpen,
  Sun,
  CalendarCheck2,
  Layers3,
  Plus,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useWorkspace } from "./workspace-provider";
import { EmptyState, QuickCapture, TaskList } from "./task-list";
import { Button } from "./ui/button";
import { goalProgress, taskSummary } from "@/lib/insights";
import { TIMEZONE, localDate, friendlyDate } from "@/lib/dates";
const DashboardWidgets = dynamic(
  () => import("./dashboard-widgets").then((module) => module.DashboardWidgets),
  {
    loading: () => (
      <section className="panel" role="status">
        Loading your personal dashboard…
      </section>
    ),
  },
);

export function HomePage({
  initialBriefing,
  initialAcademic,
  initialPlans,
}: {
  initialBriefing?: LiveBriefing | null;
  initialAcademic?: AcademicData | null;
  initialPlans?: SavedPlans | null;
}) {
  const { data: raw, request, refresh, notify, pending } = useWorkspace();
  const data = realWorkspace(raw);
  const layout = migrateLayout(raw.dashboard?.settings);
  const custom = raw.dashboard?.enabled !== false && layout.mode === "custom";
  const briefing = useBriefing(undefined, initialBriefing);
  const calendarSummary = {
    count: briefing.data?.weekly.calendar_reliable
      ? briefing.data.weekly.commitment_count
      : null,
    note: briefing.data?.weekly.calendar_reliable
      ? "This review week"
      : briefing.error
        ? "Calendar status unavailable"
        : "Check your calendar connection",
  };
  const now = useCurrentTime();
  const summary = taskSummary(data.tasks, now);
  const ranked = todayPriorities(data, now);
  const priorities = briefing.data
    ? briefing.data.recommendations.slice(1, 3).flatMap((x) => {
        const task = data.tasks.find((t) => t.id === x.task_id);
        return task ? [task] : [];
      })
    : ranked.slice(0, 3).map((x) => x.task);
  const upcoming = data.milestones
    .filter(
      (m) =>
        m.status === "planned" && m.target_date && m.target_date >= localDate(),
    )
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!))
    .filter(
      (m) =>
        new Date(m.target_date! + "T12:00Z").getTime() - now.getTime() <=
        7 * 86400000,
    );
  const recentReview = data.reviews
    .filter((r) => r.completed_at)
    .sort((a, b) => b.period_start.localeCompare(a.period_start))[0];
  const needsInit = data.areas.length === 0;
  const stats = [
    {
      label: "Tasks due today",
      value: summary.dueToday.length,
      note: summary.dueToday.length
        ? "Make time for these"
        : "No tasks due today",
      icon: CheckCheck,
    },
    {
      label: "Your week",
      value: calendarSummary.count ?? "—",
      note: calendarSummary.note,
      icon: CalendarDays,
    },
    {
      label: "Overdue",
      value: summary.overdue.length,
      note: summary.overdue.length
        ? "Ready for your attention"
        : "Nothing overdue",
      icon: Clock3,
      className: summary.overdue.length ? "danger" : "",
    },
    {
      label: "Milestones",
      value: upcoming.length,
      note: "Due in the next 7 days",
      icon: Flag,
      className: "success",
    },
  ];
  return (
    <div
      className={`home-experience dashboard-density-${layout.density} dashboard-accent-${layout.accent}`}
      id="daily-briefing"
    >
      {needsInit && (
        <div className="notice">
          <Layers3 />
          <div>
            <strong>Welcome to your private workspace</strong>
            <p>Set up a space for your courses, projects and everyday plans.</p>
          </div>
          <Button
            disabled={pending}
            onClick={async () => {
              try {
                await request("/api/v1/workspace/initialize", {
                  method: "POST",
                });
                await refresh();
                notify("Your space is ready");
              } catch (e) {
                notify(e instanceof Error ? e.message : "Setup failed");
              }
            }}
          >
            Set up my space
            <ArrowRight size={13} />
          </Button>
        </div>
      )}
      <div className="page-heading home-welcome">
        <div>
          <span className="eyebrow">A LITTLE SPACE TO THINK AHEAD</span>
          <h1>A little clarity for today.</h1>
          {layout.greeting && (
            <p>{personalGreeting(data.profile.display_name, now)}</p>
          )}
        </div>
        <span className="date-chip">
          <CalendarDays size={12} />
          {formatInTimeZone(now, TIMEZONE, "EEE, MMM d")}
        </span>
      </div>
      <div className="dashboard-tools">
        <DashboardCustomizer />
      </div>
      {layout.banner && (
        <div className="landscape-banner" aria-hidden="true">
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
            <path
              d="M0 100 170 20 330 100 540 5 790 100 900 25 1000 100Z"
              fill="currentColor"
              opacity=".28"
            />
            <path
              d="M0 100 110 50 250 100 410 35 600 100 780 45 1000 100Z"
              fill="currentColor"
              opacity=".4"
            />
          </svg>
        </div>
      )}
      <div className="home-overview">
        <BriefingPanel controller={briefing} compact hideConnectionAlerts />
        <div className="stats-grid">
          {stats.map((s) => (
            <div className={`stat-card ${s.className ?? ""}`} key={s.label}>
              <div className="stat-label">
                {s.label}
                <s.icon />
              </div>
              <span className="stat-number">{s.value}</span>
              <span className="stat-note">{s.note}</span>
            </div>
          ))}
        </div>
      </div>
      <div id="connected-data">
        <SyncHealth controller={briefing} />
      </div>
      {custom ? (
        <DashboardWidgets
          initialAcademic={initialAcademic}
          initialPlans={initialPlans}
          layout={layout}
          briefing={briefing}
          priorities={ranked.slice(0, 3).map((x) => x.task)}
        />
      ) : (
        <>
          {" "}
          <div className="dashboard-grid">
            <div className="stack home-work-column">
              <section className="panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <Sun />
                    <h2>On your list</h2>
                    {priorities.length > 0 && (
                      <span className="count-pill">{priorities.length}</span>
                    )}
                  </div>
                  <Link href="/planner" className="text-link">
                    All tasks
                    <ArrowUpRight size={12} />
                  </Link>
                </div>

                {priorities.length ? (
                  <TaskList tasks={priorities} />
                ) : (
                  <div className="home-capture-empty">
                    <span className="capture-mark" aria-hidden="true">
                      <Plus size={20} />
                    </span>
                    <p>
                      Something on your mind?
                      <small>Give it a place. You can organize it later.</small>
                    </p>
                  </div>
                )}
                <QuickCapture />
              </section>
              {(summary.overdue.length > 0 || summary.dueToday.length > 0) && (
                <section className="panel">
                  <div className="panel-heading">
                    <div className="panel-title">
                      <Flag />
                      <h2>Coming up</h2>
                    </div>
                    <Link href="/planner" className="text-link">
                      Open planner
                      <ArrowUpRight size={12} />
                    </Link>
                  </div>
                  {summary.overdue.length || summary.dueToday.length ? (
                    <TaskList
                      tasks={[...summary.overdue, ...summary.dueToday].slice(
                        0,
                        5,
                      )}
                    />
                  ) : (
                    <EmptyState
                      compact
                      icon={CalendarCheck2}
                      title="A little breathing room"
                      description="No tasks are due today or overdue. Course deadlines are in Academics."
                    />
                  )}
                </section>
              )}
              <section className="review-banner">
                <span className="section-icon">
                  <BookOpen size={19} />
                </span>
                <div>
                  <h2>Make space for a fresh week.</h2>
                  <p>
                    A few minutes to reflect, reset and choose what comes next.
                    {recentReview
                      ? ` Last completed: ${friendlyDate(recentReview.completed_at)}.`
                      : " Your review opens on Sunday."}
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/reviews">
                      {reviewAvailability(now, data.profile.timezone).open
                        ? "Start weekly review"
                        : "View review history"}
                      <ArrowRight size={12} />
                    </Link>
                  </Button>
                </div>
              </section>
            </div>
            <div className="stack home-day-column">
              <GoogleCalendarPanel
                start={localDate()}
                end={new Date(
                  new Date(localDate() + "T12:00Z").getTime() + 86400000,
                )
                  .toISOString()
                  .slice(0, 10)}
              />
              <section className="panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <Target />
                    <h2>The bigger picture</h2>
                  </div>
                  <Link href="/goals" className="text-link">
                    Goals
                    <ArrowUpRight size={12} />
                  </Link>
                </div>
                {data.goals
                  .filter((g) => g.status === "active")
                  .slice(0, 3)
                  .map((g) => {
                    const progress = goalProgress(g, data.milestones);
                    return (
                      <Link
                        href={`/goals#goal-${g.id}`}
                        className="goal-row"
                        style={{ display: "block" }}
                        key={g.id}
                      >
                        <h3>{g.title}</h3>
                        <div className="flex-between">
                          <p>{progress.label}</p>
                          {progress.percent !== null && (
                            <span className="small muted">
                              {Math.round(progress.percent)}%
                            </span>
                          )}
                        </div>
                        {progress.percent !== null && (
                          <div
                            className="progress-track"
                            role="progressbar"
                            aria-label={g.title}
                            aria-valuenow={Math.round(progress.percent)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="progress-fill"
                              style={{ width: `${progress.percent}%` }}
                            />
                          </div>
                        )}
                      </Link>
                    );
                  })}
                {!data.goals.some((g) => g.status === "active") && (
                  <EmptyState
                    compact
                    icon={Target}
                    title="Start with what matters"
                    description="Connect your everyday actions to a goal you care about."
                    action={
                      <Link href="/goals" className="text-link">
                        Set a goal
                        <Plus size={12} />
                      </Link>
                    }
                  />
                )}
              </section>
            </div>
          </div>
        </>
      )}
      <BriefingPanel controller={briefing} hideConnectionAlerts />
      <AttentionHistory />
    </div>
  );
}
