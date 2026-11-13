"use client";
import { realWorkspace } from "@/lib/real-workspace";
import Link from "next/link";
import { BriefingPanel } from "./briefing-page";
import { useBriefing } from "./use-briefing";
import { todayPriorities, personalGreeting } from "@/lib/today-priorities";

import { useEffect, useState } from "react";
import { GoogleCalendarPanel } from "./google-calendar-panel";
import { groupCalendarEvents } from "@/lib/integrations/calendar-layout";
import type {
  CalendarEvent,
  ConnectionState,
} from "@/lib/integrations/calendar-view";
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
export function HomePage() {
  const { data: raw, request, refresh, notify, pending } = useWorkspace();
  const data = realWorkspace(raw);
  const [calendarSummary, setCalendarSummary] = useState<{
    count: number | null;
    note: string;
  }>({ count: null, note: "Checking calendar connection…" });
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/v1/calendar/connections", {
          cache: "no-store",
        });
        if (!response.ok) throw Error();
        const state = (await response.json()) as ConnectionState;
        const selected = state.calendars.filter(
          (c) =>
            c.sync_enabled &&
            state.connections.some(
              (x) => x.id === c.connection_id && x.status === "connected",
            ),
        );
        if (!selected.length) {
          if (live)
            setCalendarSummary({
              count: null,
              note: "Choose calendars in Settings",
            });
          return;
        }
        const start = localDate();
        const end = new Date(
          new Date(start + "T12:00Z").getTime() + 7 * 86400000,
        )
          .toISOString()
          .slice(0, 10);
        if (
          selected.some(
            (c) =>
              c.sync_error ||
              !c.last_synced_at ||
              Date.now() - new Date(c.last_synced_at).getTime() >
                26 * 3600000 ||
              !c.coverage_start ||
              !c.coverage_end ||
              localDate(c.coverage_start) > start ||
              localDate(c.coverage_end) < end,
          )
        ) {
          if (live)
            setCalendarSummary({ count: null, note: "Calendar sync needed" });
          return;
        }
        const eventsResponse = await fetch(
          `/api/v1/calendar/events?start=${start}&end=${end}`,
          { cache: "no-store" },
        );
        if (!eventsResponse.ok) throw Error();
        const result = (await eventsResponse.json()) as {
          events: CalendarEvent[];
        };
        if (live)
          setCalendarSummary({
            count: groupCalendarEvents(result.events).length,
            note: "Cached events · next 7 days",
          });
      } catch {
        if (live)
          setCalendarSummary({
            count: null,
            note: "Calendar status unavailable",
          });
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const briefing = useBriefing();
  const now = new Date();
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
      label: "Due today",
      value: summary.dueToday.length,
      note: "Tasks with a deadline today",
      icon: CheckCheck,
    },
    {
      label: "Upcoming commitments",
      value: calendarSummary.count ?? "—",
      note: calendarSummary.note,
      icon: CalendarDays,
    },
    {
      label: "Overdue tasks",
      value: summary.overdue.length,
      note: summary.overdue.length
        ? "Ready for your attention"
        : "Nothing overdue",
      icon: Clock3,
      className: summary.overdue.length ? "danger" : "",
    },
    {
      label: "Weekly milestones",
      value: upcoming.length,
      note: "Due in the next 7 days",
      icon: Flag,
      className: "success",
    },
  ];
  return (
    <>
      {needsInit && (
        <div className="notice">
          <Layers3 />
          <div>
            <strong>Welcome to your private workspace</strong>
            <p>
              Initialize your five Life Areas. This adds organization only, with
              no invented commitments.
            </p>
          </div>
          <Button
            disabled={pending}
            onClick={async () => {
              try {
                await request("/api/v1/workspace/initialize", {
                  method: "POST",
                });
                await refresh();
                notify("Workspace initialized");
              } catch (e) {
                notify(e instanceof Error ? e.message : "Setup failed");
              }
            }}
          >
            Initialize workspace
            <ArrowRight size={13} />
          </Button>
        </div>
      )}
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR DAILY COMMAND CENTER</span>
          <h1>A little clarity for today.</h1>
          <p>{personalGreeting(data.profile.display_name, now)}</p>
        </div>
        <span className="date-chip">
          <CalendarDays size={12} />
          {formatInTimeZone(now, TIMEZONE, "EEE, MMM d")}
        </span>
      </div>
      <BriefingPanel controller={briefing} compact />
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
      <div className="dashboard-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-heading">
              <div className="panel-title">
                <Sun />
                <h2>Other next actions</h2>
                <span className="count-pill">{priorities.length}</span>
              </div>
              <Link href="/planner" className="text-link">
                All tasks
                <ArrowUpRight size={12} />
              </Link>
            </div>
            <p className="panel-description">
              Alternatives to the primary recommendation above. The same
              briefing rules rank these actions; calendar availability may be
              unknown.
            </p>
            {priorities.length ? (
              <TaskList tasks={priorities} />
            ) : (
              <EmptyState
                compact
                icon={CheckCheck}
                title="No additional actions recorded"
                description="Capture what’s on your mind. Your next priorities will appear here."
              />
            )}
            <QuickCapture />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div className="panel-title">
                <Flag />
                <h2>Deadlines to keep in view</h2>
              </div>
              <Link href="/planner" className="text-link">
                Open planner
                <ArrowUpRight size={12} />
              </Link>
            </div>
            {summary.overdue.length || summary.dueToday.length ? (
              <TaskList
                tasks={[...summary.overdue, ...summary.dueToday].slice(0, 5)}
              />
            ) : (
              <EmptyState
                compact
                icon={CalendarCheck2}
                title="No urgent deadlines recorded"
                description="Your dated tasks will appear here when they need attention."
              />
            )}
          </section>
          <section className="review-banner">
            <span className="section-icon">
              <BookOpen size={19} />
            </span>
            <div>
              <h2>A small pause. A clearer week.</h2>
              <p>
                Reflect on what moved forward and choose what comes next.
                {recentReview
                  ? ` Last completed: ${friendlyDate(recentReview.completed_at)}.`
                  : " Your first weekly review is waiting when you’re ready."}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/reviews">
                  Start weekly review
                  <ArrowRight size={12} />
                </Link>
              </Button>
            </div>
          </section>
        </div>
        <div className="stack">
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
  );
}
