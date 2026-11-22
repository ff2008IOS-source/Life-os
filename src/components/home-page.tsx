"use client";
import { calendarCoverage } from "@/lib/calendar-availability";
import { PlanningDecisions } from "./planning-decisions";
import { useEffect, useState } from "react";
import Link from "next/link";
import { calendarRequest } from "./use-calendar";
import { announceChange } from "@/lib/workspace-change";
import { useSearchParams } from "next/navigation";
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
import { todayPlan, remainingEffort } from "@/lib/today-plan";
import { DEFAULT_POLICY } from "@/lib/scheduler";
import { fromZonedTime } from "date-fns-tz";
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
  const chosen = useSearchParams().get("date");
  const [reviewOpen, setReviewOpen] = useState(false),
    [calendarBusy, setCalendarBusy] = useState(false),
    [calendarError, setCalendarError] = useState("");
  const day =
    chosen &&
    /^\d{4}-\d{2}-\d{2}$/.test(chosen) &&
    Number.isFinite(Date.parse(chosen))
      ? chosen
      : today;
  const setChosen = (value: string | null) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("date", value);
    else url.searchParams.delete("date");
    window.history.replaceState(null, "", url);
  };
  const focus = useFocusSession();
  const briefing = useBriefing(undefined, initialBriefing),
    layout = migrateLayout(raw.dashboard?.settings);
  const dates = (t: { due_date: string | null; due_at: string | null }) =>
    t.due_at ? formatInTimeZone(t.due_at, zone, "yyyy-MM-dd") : t.due_date;
  const planning = briefing.data?.planning;
  const dayStart = fromZonedTime(day + "T00:00:00", zone).getTime(),
    dayEnd = fromZonedTime(shift(day, 1) + "T00:00:00", zone).getTime();
  const reliable =
    !!planning &&
    calendarCoverage({
      calendars: planning.calendars,
      connections: planning.connections,
      start: dayStart,
      end: dayEnd,
      now: now.getTime(),
      failed: briefing.data?.source_errors.some((e) =>
        ["calendar", "work", "scheduling"].includes(e),
      ),
    }).verified;
  const workKnown =
    !!planning && !briefing.data?.source_errors.includes("work");
  const plan = todayPlan({
    workspace: data,
    day,
    zone,
    now,
    policy: planning?.policy ?? DEFAULT_POLICY,
    blocks: planning?.blocks ?? [],
    events: planning?.events ?? [],
    reliable,
  });
  const tasks = [...plan.planned, ...plan.overdue, ...plan.due],
    completed = plan.completed;
  const week = plan.week,
    liveReview = reviewAvailability(now, zone);
  const recommendation = plan.recommendation;
  const existing = briefing.data?.recommendations.find(
    (r) => r.task_id === recommendation?.id,
  );
  const focusController = {
    ...briefing,
    data: briefing.data
      ? {
          ...briefing.data,
          recommendations: recommendation
            ? [
                {
                  task_id: recommendation.id,
                  title: recommendation.title,
                  version: recommendation.version,
                  urgency: existing?.urgency ?? 0,
                  score: existing?.score ?? 0,
                  remaining_minutes:
                    remainingEffort(recommendation) === 0
                      ? null
                      : remainingEffort(recommendation),
                  fits:
                    remainingEffort(recommendation) !== null &&
                    remainingEffort(recommendation)! > 0 &&
                    remainingEffort(recommendation)! <=
                      (plan.focusMinutes ?? 0),
                  reasons: [
                    ...(plan.allocatedNow
                      ? [
                          `Current planned block · ${Math.floor(plan.focusMinutes ?? 0)} minutes until its end.`,
                        ]
                      : (existing?.reasons.slice(0, 1) ?? [])),
                    remainingEffort(recommendation) === null
                      ? "Effort unknown · start the allocated segment and add an estimate."
                      : remainingEffort(recommendation) === 0
                        ? "Estimate used up · task still open. Review the remaining effort."
                        : remainingEffort(recommendation)! >
                            (plan.focusMinutes ?? 0)
                          ? `Start a ${Math.floor(plan.focusMinutes ?? 0)} minute segment; the full task needs ${remainingEffort(recommendation)} minutes.`
                          : `${remainingEffort(recommendation)} minutes remaining · fits in the available work window.`,
                  ],
                  goals: existing?.goals ?? [],
                  project_id: recommendation.project_id,
                  deadline: recommendation.due_at ?? recommendation.due_date,
                  eligible: recommendation.scheduling_mode === "eligible",
                },
              ]
            : [],
        }
      : null,
  };
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
          ? Date.parse(a.due_at) >= (day === today ? now.getTime() : dayStart)
          : !!a.due_date && a.due_date >= day),
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
        w.visible &&
        !["plan", "schedule", "upcoming", "review"].includes(w.id) &&
        (day === today || !["sessions", "insights"].includes(w.id)),
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
              : formatInTimeZone(
                  new Date(day + "T12:00:00Z"),
                  "UTC",
                  "EEEE, MMM d, yyyy",
                )}
          </h1>
          <p className="today-summary">
            {workKnown
              ? `${Math.round(plan.plannedMinutes)} min planned`
              : "Planned work unavailable"}{" "}
            ·{" "}
            {plan.available === null
              ? "Capacity unverified"
              : `${Math.floor(plan.available)} min available`}
            {plan.unknown
              ? ` · ${plan.unknown} planned items without estimates`
              : ""}
            {plan.past &&
              " · Recorded blocks and completions; current deadlines are not a historical plan"}
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
      {day === today && (
        <div className="today-capacity" aria-label="Right now">
          <span>
            Right now ·{" "}
            {plan.next
              ? plan.next.start <= now.getTime()
                ? `In progress: ${plan.next.event.title} until ${formatInTimeZone(plan.next.end, zone, "h:mm a")}`
                : `Next commitment: ${plan.next.event.title} at ${formatInTimeZone(plan.next.start, zone, "h:mm a")}`
              : reliable
                ? "No further fixed commitment today"
                : "Calendar needs verification"}
          </span>
          <span>
            {plan.gap
              ? `${Math.floor(plan.gap.minutes)} min usable ${plan.gap.start > now.getTime() ? "from " + formatInTimeZone(plan.gap.start, zone, "h:mm a") : "now"}`
              : reliable
                ? "No remaining usable gap today"
                : "Usable gap unverified"}{" "}
            · <Link href="/planner?section=calendar">Full agenda</Link>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={calendarBusy || !planning?.calendars.length}
            onClick={async () => {
              if (!planning) return;
              setCalendarBusy(true);
              setCalendarError("");
              try {
                const results = await Promise.allSettled(
                  planning.calendars.slice(0, 20).map((c) =>
                    calendarRequest("/api/v1/calendar/sync", {
                      method: "POST",
                      body: JSON.stringify({ calendar_id: c.id }),
                    }),
                  ),
                );
                if (results.some((r) => r.status === "rejected"))
                  setCalendarError(
                    "Some calendar refreshes could not be confirmed. Saved events are still available.",
                  );
                await briefing.reload();
                announceChange(["calendar"]);
              } finally {
                setCalendarBusy(false);
              }
            }}
          >
            {calendarBusy ? "Refreshing calendars…" : "Refresh calendars"}
          </Button>
          {calendarError && (
            <p role="alert">
              {calendarError}{" "}
              <Link href="/settings?section=integrations">
                Check connections
              </Link>
            </p>
          )}
          <small>
            {briefing.data?.calendar.last_source_sync
              ? "Calendar refreshed " +
                formatInTimeZone(
                  briefing.data.calendar.last_source_sync,
                  zone,
                  "MMM d, h:mm a",
                )
              : "No successful calendar refresh"}
          </small>
        </div>
      )}
      <div className="today-layout">
        <div className="today-primary">
          {day === today && (focus?.session || recommendation) ? (
            <div className="today-focus">
              <BriefingPanel
                controller={focusController}
                compact
                hideConnectionAlerts
              />
            </div>
          ) : day === today ? (
            <p className="muted">
              {!reliable
                ? "Refresh your calendar to verify a useful work window."
                : plan.gap && plan.gap.start > now.getTime()
                  ? `Next work window at ${formatInTimeZone(plan.gap.start, zone, "h:mm a")}.`
                  : plan.available === 0
                    ? "No flexible capacity remains today."
                    : "No ready, estimated task fits this gap."}{" "}
              <Link href="/planner?section=tasks">Open Planner</Link>
            </p>
          ) : null}
          {plan.past && (
            <section aria-label="Recorded blocks">
              <h2>Recorded blocks</h2>
              {planning?.blocks
                .filter(
                  (b) =>
                    Date.parse(b.start_at) < dayEnd &&
                    Date.parse(b.end_at) > dayStart,
                )
                .map((b) => (
                  <p key={b.id}>
                    {data.tasks.find((t) => t.id === b.task_id)?.title ??
                      "Work block"}{" "}
                    · {formatInTimeZone(b.start_at, zone, "h:mm a")} –{" "}
                    {formatInTimeZone(b.end_at, zone, "h:mm a")} · current block
                    status: {b.status}
                  </p>
                ))}
            </section>
          )}
          <section aria-label="Daily tasks">
            <div className="panel-heading">
              <h2>Tasks</h2>
              <Link className="text-link" href="/planner?section=tasks">
                All tasks <ArrowUpRight size={14} />
              </Link>
            </div>
            {workKnown && !tasks.length && !completed.length && (
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
            {!plan.past &&
              [
                ["Planned today", plan.planned],
                ["Overdue", plan.overdue],
                ["Due today", plan.due],
              ]
                .filter(
                  ([label, items]) =>
                    (items as typeof tasks).length > 0 ||
                    (label === "Planned today" && !workKnown),
                )
                .map(([label, items]) => (
                  <section key={String(label)}>
                    <h3>{String(label)}</h3>
                    <TaskList
                      tasks={items as typeof tasks}
                      allocations={
                        label === "Planned today" ? plan.allocations : undefined
                      }
                      referenceDate={
                        day === today
                          ? now
                          : fromZonedTime(day + "T00:00:00", zone)
                      }
                      completedExpanded={false}
                    />
                    {label === "Planned today" && !workKnown && (
                      <p role="status">
                        Planned blocks could not load.{" "}
                        <Button
                          variant="ghost"
                          onClick={() => void briefing.reload()}
                        >
                          Retry planned blocks
                        </Button>
                      </p>
                    )}
                    {!(items as typeof tasks).length &&
                      (label !== "Planned today" || workKnown) && (
                        <p className="small muted">None.</p>
                      )}
                  </section>
                ))}
            {!plan.past && plan.waiting.length > 0 && (
              <section>
                <h3>Waiting</h3>
                {plan.waiting.map((task) => (
                  <div key={task.id}>
                    <TaskList tasks={[task]} />
                    <p className="small muted">
                      {plan.blocking(task).length
                        ? "Waiting for "
                        : "Prerequisite unavailable · check this task’s dependencies."}
                      {plan.blocking(task).map((t) => (
                        <Link
                          key={t.id}
                          href={`/planner?section=tasks&task=${t.id}`}
                        >
                          {t.title}
                        </Link>
                      ))}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {day === today && (
              <details className="today-inbox">
                <summary>Inbox · {plan.inbox.length} unplanned </summary>
                <Link href="/planner?section=inbox">Open Inbox</Link>
                <TaskList tasks={plan.inbox.slice(0, 3)} />
              </details>
            )}
            {completed.length > 0 && (
              <TaskList tasks={completed} completedExpanded={false} />
            )}
            <QuickCapture />
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
              <h2>
                {plan.past ? "Assessments · current records" : "Upcoming"}
              </h2>
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
          {day === today && (
            <section className="today-review">
              <div>
                <h2>Weekly review</h2>
                <p>
                  {liveReview.open ? "Open for this week." : "Opens Sunday."}
                </p>
              </div>
              <Link className="text-link" href="/reviews">
                {liveReview.open ? "Open" : "History"}{" "}
                <ArrowUpRight size={14} />
              </Link>
            </section>
          )}
        </aside>
      </div>
      {raw.dashboard?.enabled !== false &&
        layout.mode === "custom" &&
        extras.widgets.some((w) => w.visible) && (
          <div className="today-additional">
            {day !== today && (
              <p className="small muted">
                Current workspace records; historical workspace snapshots are
                not available.
              </p>
            )}
            <DashboardWidgets
              initialAcademic={initialAcademic}
              initialPlans={initialPlans}
              layout={extras}
              briefing={briefing}
              priorities={tasks.slice(0, 3)}
            />
          </div>
        )}
      {day === today && (
        <details
          className="today-details"
          open={reviewOpen}
          onToggle={(e) => setReviewOpen(e.currentTarget.open)}
        >
          <summary>Day review & attention</summary>
          {reviewOpen && (
            <BriefingPanel controller={briefing} hideConnectionAlerts />
          )}
        </details>
      )}
      {day === today && (
        <PlanningDecisions
          initial={briefing.data?.planning_decisions}
          checkKey={
            planning?.blocks
              .filter(
                (b) =>
                  b.status === "planned" &&
                  Date.parse(b.end_at) < now.getTime(),
              )
              .map((b) => b.id + ":" + b.start_at + ":" + b.end_at)
              .sort()
              .join("|") ?? ""
          }
          needsCheck={
            !!planning?.blocks.some(
              (b) =>
                b.status === "planned" && Date.parse(b.end_at) < now.getTime(),
            )
          }
        />
      )}
      <div id="connected-data">
        <SyncHealth controller={briefing} />
      </div>
      <AttentionHistory />
    </div>
  );
}
