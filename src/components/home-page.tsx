"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ArrowUpRight,
  BookOpen,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import type { LiveBriefing } from "@/lib/briefing-server";
import type { SavedPlans } from "@/lib/services/saved-plans";
import type { AcademicData } from "./academic-editor";
import { migrateLayout } from "@/lib/dashboard-layout";
import { realWorkspace } from "@/lib/real-workspace";
import { todayPriorities } from "@/lib/today-priorities";
import { reviewAvailability } from "@/lib/temporal-context";
import { useWorkspace } from "./workspace-provider";
import { useCurrentTime } from "./use-current-time";
import { useFocusSession } from "./focus-session-provider";
import { useBriefing } from "./use-briefing";
import { BriefingPanel } from "./briefing-page";
import { TaskList, QuickCapture } from "./task-list";
import { GoogleCalendarPanel } from "./google-calendar-panel";
import { DashboardCustomizer } from "./dashboard-customizer";
import { SyncHealth } from "./sync-health";
import { AttentionHistory } from "./attention-history";
import { Button } from "./ui/button";
const DashboardWidgets = dynamic(() =>
  import("./dashboard-widgets").then((m) => m.DashboardWidgets),
);
function shift(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
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
  const data = realWorkspace(raw),
    now = useCurrentTime(),
    zone = data.profile.timezone;
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const [chosen, setChosen] = useState<string | null>(null),
    [reviewOpen, setReviewOpen] = useState(false);
  const day = chosen ?? today;
  const focus = useFocusSession();
  const briefing = useBriefing(undefined, initialBriefing),
    layout = migrateLayout(raw.dashboard?.settings);
  const dates = (t: { due_date: string | null; due_at: string | null }) =>
    t.due_date ??
    (t.due_at ? formatInTimeZone(t.due_at, zone, "yyyy-MM-dd") : null);
  const ranked = todayPriorities(data, now);
  const tasks = ranked
    .map((r) => r.task)
    .filter(
      (t) =>
        !t.recurrence_rule_id && (dates(t) ? dates(t)! <= day : day === today),
    );
  const completed = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.status === "completed" &&
      t.completed_at &&
      formatInTimeZone(t.completed_at, zone, "yyyy-MM-dd") === day,
  );
  const estimated = tasks.reduce((n, t) => n + (t.estimated_minutes ?? 0), 0),
    unknown = tasks.filter((t) => t.estimated_minutes === null).length;
  const week = reviewAvailability(now, zone);
  const dueThisWeek = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      !t.recurrence_rule_id &&
      t.status !== "cancelled" &&
      dates(t) &&
      dates(t)! >= week.weekStart &&
      dates(t)! <= week.weekEnd,
  );
  const finishedWeek = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.status === "completed" &&
      t.completed_at &&
      formatInTimeZone(t.completed_at, zone, "yyyy-MM-dd") >= week.weekStart &&
      formatInTimeZone(t.completed_at, zone, "yyyy-MM-dd") <= week.weekEnd,
  );
  const upcoming = briefing.data?.assessments
    .filter(
      (a) =>
        !a.dropped &&
        !["returned", "submitted", "excused"].includes(a.submission_state) &&
        (a.due_at
          ? Date.parse(a.due_at) >= now.getTime()
          : !!a.due_date && a.due_date >= today),
    )
    .sort((a, b) =>
      String(a.due_at ?? a.due_date).localeCompare(
        String(b.due_at ?? b.due_date),
      ),
    )
    .slice(0, 5);
  const extras = {
    ...layout,
    widgets: layout.widgets.map((w) => ({
      ...w,
      visible:
        w.visible && !["plan", "schedule", "upcoming", "review"].includes(w.id),
    })),
  };
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#needs-attention") setReviewOpen(true);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <div
      className={`home-experience dashboard-density-${layout.density} dashboard-accent-${layout.accent}`}
      id="daily-briefing"
    >
      {!data.areas.length && (
        <div className="notice">
          <span>Set up your workspace to add courses and projects.</span>
          <Button
            disabled={pending}
            onClick={async () => {
              try {
                await request("/api/v1/workspace/initialize", {
                  method: "POST",
                });
                await refresh();
                notify("Workspace ready");
              } catch (e) {
                notify(e instanceof Error ? e.message : "Setup failed");
              }
            }}
          >
            Set up my space
          </Button>
        </div>
      )}
      <div className="today-heading">
        <div>
          <h1>
            {day === today
              ? "Today"
              : formatInTimeZone(new Date(day + "T12:00:00Z"), "UTC", "EEEE")}
          </h1>
          <p className="today-summary">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            {estimated > 0
              ? ` · ${estimated >= 60 ? `${Math.floor(estimated / 60)}h${estimated % 60 ? ` ${estimated % 60}m` : ""}` : `${estimated} min`} estimated`
              : ""}
            {unknown ? ` · ${unknown} without estimates` : ""}
          </p>
        </div>
        <div className="today-date">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            onClick={() => setChosen(shift(day, -1))}
          >
            <ChevronLeft />
          </Button>
          <input
            type="date"
            aria-label="Dashboard date"
            value={day}
            onChange={(e) => setChosen(e.target.value || null)}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            onClick={() => setChosen(shift(day, 1))}
          >
            <ChevronRight />
          </Button>
          {day !== today && (
            <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
              Today
            </Button>
          )}
        </div>
      </div>
      <div className="today-layout">
        <div className="today-primary">
          {day === today &&
          (focus?.session ||
            briefing.data?.recommendations.length ||
            briefing.data?.assessments.some(
              (a) =>
                !["returned", "submitted", "excused"].includes(
                  a.submission_state,
                ),
            )) ? (
            <div className="today-focus">
              <BriefingPanel
                controller={briefing}
                compact
                hideConnectionAlerts
              />
            </div>
          ) : null}
          <section aria-label="Daily tasks">
            <div className="panel-heading">
              <h2>Tasks</h2>
              <Link className="text-link" href="/planner?section=tasks">
                All tasks <ArrowUpRight size={14} />
              </Link>
            </div>
            {!tasks.length && !completed.length && (
              <p className="muted">
                Nothing planned for{" "}
                {day === today
                  ? "today"
                  : formatInTimeZone(
                      new Date(day + "T12:00:00Z"),
                      "UTC",
                      "MMM d",
                    )}
                .
              </p>
            )}
            <TaskList
              tasks={[...tasks, ...completed]}
              completedExpanded={false}
            />
            <QuickCapture dueDate={day === today ? undefined : day} />
          </section>
          <div className="today-actions">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/planner?section=calendar">
                <Plus /> Calendar
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/areas/academics?view=study">
                <BookOpen /> Study
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReviewOpen((v) => !v)}
            >
              Daily check-in
            </Button>
            <DashboardCustomizer />
          </div>
        </div>
        <aside
          className="today-secondary"
          aria-label="Schedule and upcoming work"
        >
          <GoogleCalendarPanel start={day} end={shift(day, 1)} />
          <section>
            <div className="panel-heading">
              <h2>Upcoming</h2>
              <Link className="text-link" href="/areas/academics">
                Academics <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="today-upcoming">
              {upcoming?.map((a) => (
                <Link
                  key={a.id}
                  href={`/areas/academics?course=${a.course_id}&assessment=${a.id}`}
                >
                  <strong>{a.title}</strong>
                  <time>
                    {a.due_at
                      ? formatInTimeZone(a.due_at, zone, "EEE, MMM d · h:mm a")
                      : formatInTimeZone(
                          new Date(a.due_date! + "T12:00:00Z"),
                          "UTC",
                          "EEE, MMM d",
                        )}
                  </time>
                </Link>
              ))}
              {upcoming?.length === 0 &&
                !briefing.data?.source_errors.includes("academics") && (
                  <p className="small muted">No upcoming assessments.</p>
                )}
              {(!upcoming ||
                briefing.data?.source_errors.includes("academics")) && (
                <p className="small muted">
                  {briefing.error ||
                  briefing.data?.source_errors.includes("academics")
                    ? "Assessments couldn’t load."
                    : "Loading assessments…"}
                </p>
              )}
            </div>
          </section>
          <section>
            <div className="panel-heading">
              <h2>This week</h2>
              <Link className="text-link" href="/insights">
                Activity <ArrowUpRight size={14} />
              </Link>
            </div>
            {dueThisWeek.length > 0 ? (
              <div className="today-week-row">
                <span>Tasks due this week</span>
                <span>
                  {dueThisWeek.filter((t) => t.status === "completed").length} /{" "}
                  {dueThisWeek.length} complete
                </span>
              </div>
            ) : (
              <div className="today-week-row">
                <span>Completed tasks</span>
                <span>{finishedWeek.length}</span>
              </div>
            )}
            {dueThisWeek.length > 0 && (
              <progress
                className="weekly-progress"
                max={dueThisWeek.length}
                value={
                  dueThisWeek.filter((t) => t.status === "completed").length
                }
                aria-label="Tasks due this week completed"
              />
            )}
            <p className="small muted" style={{ marginTop: 12 }}>
              {finishedWeek.length
                ? `${finishedWeek.length} completed this week.`
                : "No completed tasks this week."}
            </p>
          </section>
          <section className="today-review">
            <div>
              <h2>Weekly review</h2>
              <p>{week.open ? "Open for this week." : "Opens Sunday."}</p>
            </div>
            <Link className="text-link" href="/reviews">
              {week.open ? "Open" : "History"} <ArrowUpRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
      {raw.dashboard?.enabled !== false &&
        layout.mode === "custom" &&
        extras.widgets.some((w) => w.visible) && (
          <div className="today-additional">
            <DashboardWidgets
              initialAcademic={initialAcademic}
              initialPlans={initialPlans}
              layout={extras}
              briefing={briefing}
              priorities={tasks.slice(0, 3)}
            />
          </div>
        )}
      <details
        className="today-details"
        open={reviewOpen}
        onToggle={(e) => setReviewOpen(e.currentTarget.open)}
      >
        <summary>Day review & attention</summary>
        <BriefingPanel controller={briefing} hideConnectionAlerts />
      </details>
      <div id="connected-data">
        <SyncHealth controller={briefing} />
      </div>
      <AttentionHistory />
    </div>
  );
}
