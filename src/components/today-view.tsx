"use client";
import { MailChangesCard } from "./course-updates";
import { useAcceptedOverlaps } from "./use-overlaps";
import { usePreference } from "./use-preference";
import { overlapKey } from "@/lib/overlaps";
import { WeekFitLine } from "./week-fit-line";
import { wrapUp } from "@/lib/wrap-up";
import { FollowUpNudge } from "./career-follow-ups";
import { DayArc, RhythmDots, Shimmer, Swish, useLeaving } from "./living";
import { areaOf, weekSkyline } from "@/lib/areas";
import { minutesLabel } from "@/lib/calendar-style";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Pause,
  Play,
  RefreshCw,
  Shuffle,
  Square,
  Target,
} from "lucide-react";
import { buildAgenda, type Agenda, type WorkItem } from "@/lib/today-agenda";
import { realWorkspace } from "@/lib/real-workspace";
import { announceChange } from "@/lib/workspace-change";
import type { Goal, Task } from "@/lib/schemas";
import { useWorkspace } from "./workspace-provider";
import { useFocusSession } from "./focus-session-provider";
import { useCurrentTime } from "./use-current-time";
import { calendarRequest } from "./use-calendar";
import type { BriefingController } from "./use-briefing";
import { taskValues } from "./task-editor";
import { dayBadge, dayLabel } from "@/lib/display";
import { ReconnectGoogle, needsReconnect } from "./reconnect-google";

const STALE_MS = 26 * 3600000;

function goalValues(g: Goal) {
  return {
    title: g.title,
    source_id: g.source_id ?? null,
    source_key: g.source_key ?? null,
    description: g.description,
    area_id: g.area_id,
    parent_goal_id: g.parent_goal_id,
    progress_type: g.progress_type,
    target_value: g.target_value,
    current_value: g.current_value,
    unit: g.unit,
    start_date: g.start_date,
    target_date: g.target_date,
    status: g.status,
  };
}
/** "Due tomorrow 4:20 PM", "Overdue since Nov 20", "No deadline". */
function dueLabel(item: WorkItem) {
  if (item.due === null) return "No deadline";
  return item.dueText.startsWith("overdue")
    ? item.dueText[0].toUpperCase() + item.dueText.slice(1)
    : `Due ${item.dueText}`;
}
function plusDays(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const shortDay = (day: string) =>
  formatInTimeZone(new Date(day + "T12:00:00Z"), "UTC", "MMM d");

export function TodayView({ briefing }: { briefing: BriefingController }) {
  const { data: raw, mutate, request, refresh, notify } = useWorkspace();
  const data = realWorkspace(raw);
  const focus = useFocusSession();
  const now = useCurrentTime();
  const zone = data.profile.timezone || "America/Vancouver";
  const b = briefing.data;
  // "Other" skips a suggestion for the rest of today, on every device.
  const [skips, saveSkips] = usePreference<{ date: string; keys: string[] }>(
    "today_skips",
    { date: "", keys: [] },
  );
  const [busy, setBusy] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const { accepted: acceptedOverlaps, accept: acceptOverlap } =
    useAcceptedOverlaps();
  const leaving = useLeaving();

  const agenda: Agenda | null = useMemo(() => {
    if (!b) return null;
    return buildAgenda({
      now,
      zone,
      events: b.planning.events,
      blocks: b.planning.blocks,
      calendars: b.planning.calendars,
      assessments: b.assessments,
      tasks: data.tasks,
      goals: data.goals,
      goalTasks: data.goalTasks,
      milestones: data.milestones,
      dependencies: data.dependencies,
      focusMinutesThisWeek:
        b.weekly.reported_minutes + b.weekly.reported_academic_minutes,
      dailyCap: b.planning.policy.max_daily_minutes,
      // Suggested work stays inside the saved scheduling window (9 AM–9 PM).
      dayStartHour: b.planning.policy.start_hour,
      dayEndHour: b.planning.policy.end_hour,
      acceptedOverlaps,
    });
  }, [
    b,
    now,
    zone,
    acceptedOverlaps,
    data.tasks,
    data.goals,
    data.goalTasks,
    data.milestones,
    data.dependencies,
  ]);

  // Today shows the running session itself, so the floating timer stays hidden here.
  const inline = !!b && !!focus?.session;
  const setInlineAvailable = focus?.setInlineAvailable;
  useEffect(() => {
    setInlineAvailable?.(inline);
    return () => setInlineAvailable?.(false);
  }, [inline, setInlineAvailable]);

  const lastSync = b?.calendar.last_source_sync ?? null;
  const calendarFailed =
    !!b?.source_errors.some((e) => e === "calendar") ||
    !!b?.planning.calendars.some((c) => c.sync_error);
  const stale =
    !lastSync ||
    now.getTime() - Date.parse(lastSync) > STALE_MS ||
    calendarFailed;
  const hasCalendars = !!b?.planning.calendars.length;
  const reconnect =
    needsReconnect(b?.planning.calendars.map((c) => c.sync_error) ?? []) ||
    /sign in again/.test(syncError);

  async function refreshCalendars() {
    if (!b) return;
    setSyncing(true);
    setSyncError("");
    try {
      const results = await Promise.allSettled(
        b.planning.calendars.slice(0, 20).map((c) =>
          calendarRequest("/api/v1/calendar/sync", {
            method: "POST",
            body: JSON.stringify({ calendar_id: c.id }),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        const reason = (failed[0] as PromiseRejectedResult).reason;
        setSyncError(
          reason instanceof Error && /reconnect/i.test(reason.message)
            ? "Google needs you to sign in again before your calendar can update."
            : `${failed.length} of ${results.length} calendars didn’t update. Your saved schedule is still shown.`,
        );
      }
      await briefing.reload();
      announceChange(["calendar"]);
    } finally {
      setSyncing(false);
    }
  }

  async function startWork(item: WorkItem, minutes: number) {
    if (!focus) return;
    setBusy("start:" + item.key);
    try {
      let taskId = item.task_id;
      if (!taskId && item.kind === "topic") {
        const r = (await request("/api/v1/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: `${item.label} — ${item.title}`.slice(0, 200),
            status: "planned",
            estimated_minutes: minutes,
          }),
        })) as { data: { id: string } };
        taskId = r.data.id;
        await refresh();
      }
      if (!taskId && item.kind === "assessment") {
        if (!item.version)
          throw Error("Refresh to load this assessment first.");
        const r = (await request("/api/v1/academics/prepare", {
          method: "POST",
          body: JSON.stringify({
            assessment_id: item.id,
            version: item.version,
            estimated_minutes: Math.max(minutes, item.minutes),
            eligible: false,
          }),
        })) as { task_id: string };
        taskId = r.task_id;
        await refresh();
        void briefing.reload();
      }
      if (taskId) await focus.start(taskId);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t start this session.");
    } finally {
      setBusy("");
    }
  }

  async function completeTask(task: Task) {
    setBusy("task:" + task.id);
    try {
      const r = (await mutate(
        "tasks",
        task.id,
        { ...taskValues(task), status: "completed" },
        task.version,
      )) as { data: Task };
      notify("Done", async () => {
        await mutate("tasks", task.id, taskValues(task), r.data.version);
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t save that.");
    } finally {
      setBusy("");
    }
  }

  /** Hands a manual task to the scheduler so it finds the next free slot. */
  async function scheduleTask(task: Task) {
    setBusy("task:" + task.id);
    try {
      await mutate(
        "tasks",
        task.id,
        { ...taskValues(task), scheduling_mode: "eligible" },
        task.version,
      );
      notify("Life OS will find time for it");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t save that.");
    } finally {
      setBusy("");
    }
  }

  async function updateGoal(
    goal: Goal,
    change: Partial<Goal>,
    message: string,
  ) {
    setBusy("goal:" + goal.id);
    try {
      const r = (await mutate(
        "goals",
        goal.id,
        { ...goalValues(goal), ...change },
        goal.version,
      )) as { data: Goal };
      notify(message, async () => {
        await mutate("goals", goal.id, goalValues(goal), r.data.version);
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t update this goal.");
    } finally {
      setBusy("");
    }
  }

  async function addNextStep(goal: Goal, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("step") ?? "").trim();
    if (!title) return;
    setBusy("goal:" + goal.id);
    try {
      const r = (await mutate("tasks", null, {
        title,
        status: "planned",
        area_id: goal.area_id,
      })) as { data: Task };
      await request(`/api/v1/tasks/${r.data.id}/links`, {
        method: "POST",
        body: JSON.stringify({ kind: "goal", id: goal.id }),
      });
      await refresh();
      form.reset();
      notify("Next step added");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn’t add that step.");
    } finally {
      setBusy("");
    }
  }

  const fmt = (ms: number, pattern = "h:mm a") =>
    formatInTimeZone(ms, zone, pattern);
  const clock = (ms: number) => fmt(ms, "h:mm");
  const greeting = b?.greeting ?? "Welcome back.";

  if (!b || !agenda)
    return (
      <div className="td" aria-busy="true">
        <header className="td-header">
          <p className="td-eyebrow">
            {fmt(now.getTime(), "EEE, MMM d").toUpperCase()}
          </p>
          <h1>Today</h1>
          {briefing.error ? (
            <p className="td-summary">Your day couldn’t load.</p>
          ) : (
            <Shimmer lines={3} label="Loading your day" />
          )}
          {briefing.error && (
            <button
              className="td-btn td-btn-ghost"
              onClick={() => void briefing.reload()}
            >
              Try again
            </button>
          )}
        </header>
      </div>
    );

  const work = agenda.timeline.filter((e) => e.kind === "work" && !e.planned);
  const reservedCount = agenda.timeline.filter(
    (e) => e.kind === "work" && e.planned,
  ).length;
  const dueTomorrow = agenda.due.filter((d) => d.urgent).length;
  const summary = [
    agenda.eventCount
      ? `${agenda.eventCount} on your calendar`
      : "Nothing on your calendar",
    reservedCount
      ? `${reservedCount} work session${reservedCount === 1 ? "" : "s"} planned`
      : null,
    work.length
      ? `${work.length} work block${work.length === 1 ? "" : "s"} suggested`
      : null,
    dueTomorrow ? `${dueTomorrow} due within a day and a half` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The day arc: where now sits in the saved planning window.
  const hourNow =
    Number(fmt(now.getTime(), "H")) + Number(fmt(now.getTime(), "m")) / 60;
  const dayStart = b.planning.policy.start_hour;
  const dayEnd = b.planning.policy.end_hour;
  const dayFraction = (hourNow - dayStart) / Math.max(1, dayEnd - dayStart);
  const minutesLeft = Math.max(0, Math.round((dayEnd - hourNow) * 60));
  const ahead = agenda.timeline.filter((e) => e.start > now.getTime()).length;
  const sky =
    hourNow < 5 || hourNow >= 21
      ? "night"
      : hourNow < 11
        ? "morning"
        : hourNow < 17
          ? "day"
          : "evening";
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    fmt(agenda.week.start + i * 86400000 + 12 * 3600000, "yyyy-MM-dd"),
  );
  const skyline = weekSkyline(
    b.planning.events,
    b.assessments
      .filter((a) => a.due_at || a.due_date)
      .map((a) => ({
        title: a.title,
        label: a.course,
        due: a.due_at
          ? Date.parse(a.due_at)
          : Date.parse(a.due_date + "T20:00:00Z"),
      })),
    weekDays[0],
    zone,
  );
  const busiest = Math.max(240, ...skyline.map((d) => d.busyMinutes));
  const freeToday = agenda.gaps.reduce((n, g) => n + g.minutes, 0);
  const nextExam =
    agenda.due.find(
      (d) =>
        d.status !== "done" && /exam|midterm|test|final|quiz/i.test(d.title),
    ) ??
    b.assessments
      .filter(
        (a) =>
          /exam|midterm|test|final/i.test(a.title) &&
          a.earned_score === null &&
          (a.due_at || a.due_date),
      )
      .map((a) => ({
        title: a.title,
        label: a.course,
        due: a.due_at
          ? Date.parse(a.due_at)
          : Date.parse(a.due_date + "T20:00:00Z"),
      }))
      .filter((a) => a.due >= now.getTime())
      .sort((x, y) => x.due - y.due)[0];

  // Do this next
  const session = focus?.session ?? null;
  const sessionTask = session
    ? data.tasks.find((t) => t.id === session.task_id)
    : null;
  const elapsed = session
    ? session.elapsed_seconds +
      (session.running_since
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - Date.parse(session.running_since)) / 1000,
            ),
          )
        : 0)
    : 0;
  const skipped = skips.date === agenda.today ? skips.keys : [];
  // "Other" walks through everything worth doing: the top picks, then every
  // open task in every area, then study topics that need review.
  const topicItems = (b.weekly.needs_review ?? []).map(
    (t, i): Agenda["next"][number] => ({
      item: {
        key: `topic:${t.course_id}:${i}:${t.title}`,
        kind: "topic",
        id: t.course_id,
        task_id: null,
        title: `Review ${t.title}`,
        label:
          b.assessments.find((a) => a.course_id === t.course_id)?.course ??
          "Study",
        due: null,
        dueText: "no deadline",
        minutes: 30,
        goals: [],
        priority: 2,
      },
      minutes: 30,
    }),
  );
  const everything = [...agenda.pool, ...topicItems];
  const open = everything.filter((n) => !skipped.includes(n.item.key));
  // Once every suggestion is skipped, start over rather than show nothing.
  const choice = (open.length ? open : everything)[0] ?? null;
  const choiceTask =
    choice?.item.kind === "task"
      ? (data.tasks.find((t) => t.id === choice.item.id) ?? null)
      : null;
  const windowText = agenda.nextWindow
    ? agenda.nextWindow.start <= now.getTime() + 60000
      ? `Now until ${fmt(agenda.nextWindow.end)} · ${Math.round(agenda.nextWindow.minutes)} min`
      : `${clock(agenda.nextWindow.start)}–${fmt(agenda.nextWindow.end)} · ${Math.round(agenda.nextWindow.minutes)} min free`
    : null;
  const wrap = wrapUp(data.tasks, now, zone);
  const openDue = agenda ? agenda.due.filter((d) => d.status !== "done") : [];
  const handedIn = agenda ? agenda.due.length - openDue.length : 0;
  // With nothing urgent, suggest the most useful review instead of "nothing".
  const reviewTopic = b?.weekly.needs_review[0] ?? null;
  const reviewCourse = reviewTopic
    ? (b?.assessments.find((a) => a.course_id === reviewTopic.course_id)
        ?.course ?? null)
    : null;
  const clash = agenda.clashes[0];
  const nudgeOverdue = agenda.nudges.find((n) => n.kind === "overdue");
  const nudgeStep = agenda.nudges.find((n) => n.kind === "no-next-step");
  const suggested = new Set(
    agenda.timeline.flatMap((e) => (e.kind === "work" ? [e.item.id] : [])),
  );
  const quickWins = agenda.inbox
    .filter((t) => !suggested.has(t.id))
    .slice(0, 2);
  const graded = b.assessments
    .filter((a) => a.earned_score !== null && a.maximum_score)
    .sort((x, y) =>
      String(y.due_at ?? y.due_date).localeCompare(
        String(x.due_at ?? x.due_date),
      ),
    )
    .slice(0, 3);
  const today = agenda.today;

  return (
    <div className="td">
      <header className={`td-header lv-sky lv-sky-${sky}`}>
        <div className="td-header-row">
          <div className="td-eyebrow">
            <h1 className="td-h1">Today</h1>
            <span aria-hidden> · </span>
            <time dateTime={agenda.today}>
              {fmt(now.getTime(), "EEE, MMM d").toUpperCase()}
            </time>
          </div>
          {hasCalendars &&
            (reconnect ? (
              <span className="td-pill td-pill-warn">
                Google needs you to sign in again
              </span>
            ) : stale ? (
              <button
                className="td-pill td-pill-warn"
                onClick={() => void refreshCalendars()}
                disabled={syncing}
              >
                <RefreshCw
                  size={13}
                  aria-hidden
                  className={syncing ? "td-spin" : ""}
                />
                {syncing
                  ? "Updating…"
                  : lastSync
                    ? `Calendar from ${fmt(Date.parse(lastSync), "MMM d")} · Update`
                    : "Update calendar"}
              </button>
            ) : (
              <span className="td-pill td-pill-ok">
                <span className="td-dot" aria-hidden />
                Synced · {fmt(Date.parse(lastSync!))}
              </span>
            ))}
        </div>
        <div className="td-greet-row">
          <div>
            <p className="td-greeting">{greeting.replace(/\.$/, "")}</p>
            <p className="td-summary">
              {summary || "Nothing scheduled yet today."}
            </p>
          </div>
          <DayArc
            fraction={dayFraction}
            label={
              hourNow < dayStart
                ? `Day starts at ${dayStart % 12 || 12} ${dayStart < 12 ? "AM" : "PM"}`
                : minutesLeft === 0
                  ? "Day’s plan is done"
                  : `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m left`
            }
            detail={
              minutesLeft === 0
                ? undefined
                : ahead
                  ? `${ahead} thing${ahead === 1 ? "" : "s"} still ahead`
                  : "Nothing else scheduled"
            }
          />
        </div>
        <div className="headline-numbers" aria-label="Today at a glance">
          {agenda.next.length > 0 && (
            <div
              className={`area-${areaOf(agenda.next[0].item.title, agenda.next[0].item.label)}`}
            >
              <b>{agenda.next.length}</b>
              <span>
                thing{agenda.next.length === 1 ? "" : "s"} worth doing, starting
                with {agenda.next[0].item.title.split(/\s[—·-]\s/)[0]}
              </span>
            </div>
          )}
          {nextExam && (
            <Link href="/areas/academics" className="area-school">
              <b>
                {Math.max(
                  0,
                  Math.ceil((nextExam.due - now.getTime()) / 86400000),
                )}
              </b>
              <span>
                days until {nextExam.label} {nextExam.title}
              </span>
            </Link>
          )}
          <Link href="/planner?section=calendar" className="area-study">
            <b>
              {freeToday >= 60
                ? `${Math.floor(freeToday / 60)}h`
                : `${freeToday}m`}
            </b>
            <span>free in the rest of today</span>
          </Link>
          <div className="area-career">
            <b>
              {agenda.week.deadlinesDone}/{agenda.week.deadlinesTotal}
            </b>
            <span>deadlines cleared this week</span>
          </div>
        </div>
        {reconnect && (
          <div className="td-reconnect" role="alert">
            <p>
              Your calendar and spreadsheets stopped updating
              {lastSync ? ` on ${dayLabel(Date.parse(lastSync), now)}` : ""}.
              Changes you made in Google since then aren’t shown here yet.
            </p>
            <ReconnectGoogle />
          </div>
        )}
        {syncError && !reconnect && (
          <p className="td-alert" role="alert">
            {syncError}{" "}
            <Link href="/settings?section=integrations">Fix connection</Link>
          </p>
        )}
      </header>

      <div className="td-grid">
        <div className="td-col">
          <section
            className={`td-now shape-poster area-${
              session
                ? areaOf(sessionTask?.title ?? "")
                : choice
                  ? areaOf(choice.item.title, choice.item.label)
                  : "other"
            } ${choice && leaving.isLeaving(choice.item.key) ? "lv-leaving" : ""}`}
            aria-label="Do this next"
          >
            {(session || choice) && (
              <span className="poster-number" aria-hidden>
                {session ? Math.floor(elapsed / 60) : choice!.minutes}
              </span>
            )}
            {session ? (
              <>
                <div className="td-now-top">
                  <span className="td-kicker">
                    {session.status === "running" ? "Focusing" : "Paused"}
                  </span>
                  {agenda.nextEvent && (
                    <span className="td-now-window">
                      Next: {agenda.nextEvent.title} at{" "}
                      {fmt(agenda.nextEvent.start)}
                    </span>
                  )}
                </div>
                <h2 className="td-now-title" data-current-focus tabIndex={-1}>
                  {sessionTask?.title ?? "Your work session"}
                </h2>
                <p className="td-timer" aria-live="off">
                  {Math.floor(elapsed / 60)}
                  <small> min</small>
                </p>
                <div className="td-actions">
                  <button
                    className="td-btn td-btn-light"
                    onClick={() => focus?.finish()}
                    disabled={focus?.busy}
                  >
                    <Square size={15} aria-hidden /> Finish &amp; log
                  </button>
                  <button
                    className="td-btn td-btn-outline"
                    onClick={() => void focus?.toggle()}
                    disabled={focus?.busy}
                    aria-label={
                      session.status === "running"
                        ? "Pause current focus"
                        : "Resume current focus"
                    }
                  >
                    {session.status === "running" ? (
                      <>
                        <Pause size={15} aria-hidden /> Pause
                      </>
                    ) : (
                      <>
                        <Play size={15} aria-hidden /> Resume
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : choice ? (
              <>
                <div className="td-now-top">
                  <span className="td-kicker">Do this next</span>
                  {windowText && (
                    <span className="td-now-window">{windowText}</span>
                  )}
                </div>
                <h2 key={choice.item.key} className="td-now-title lv-arrive">
                  {choice.item.title}
                </h2>
                <div className="td-chips">
                  <span className="td-chip">{choice.item.label}</span>
                  <span className="td-chip td-chip-hot">
                    {choice.item.due === null
                      ? "No deadline"
                      : dueLabel(choice.item)}
                  </span>
                  {choice.item.goals.slice(0, 1).map((g) => (
                    <Link
                      key={g.id}
                      href={`/goals#goal-${g.id}`}
                      className="td-chip td-chip-goal"
                    >
                      <Target size={12} aria-hidden /> {g.title}
                    </Link>
                  ))}
                </div>
                <div className="td-actions">
                  <button
                    className="td-btn td-btn-primary"
                    disabled={!focus?.canStart || !!busy}
                    onClick={() => void startWork(choice.item, choice.minutes)}
                  >
                    <Play size={15} aria-hidden />
                    {busy === "start:" + choice.item.key
                      ? "Starting…"
                      : `Start ${choice.minutes} min`}
                  </button>
                  {choiceTask && (
                    <button
                      className="td-btn td-btn-outline"
                      disabled={!!busy}
                      onClick={() =>
                        void leaving.run(choice.item.key, () =>
                          completeTask(choiceTask),
                        )
                      }
                      aria-label={`Mark ${choiceTask.title} done`}
                    >
                      <Check size={15} aria-hidden /> Done
                    </button>
                  )}
                  {everything.length > 1 && (
                    <button
                      className="td-btn td-btn-outline"
                      onClick={() =>
                        saveSkips({
                          date: agenda.today,
                          keys:
                            open.length > 1
                              ? [...skipped, choice.item.key].slice(-300)
                              : [],
                        })
                      }
                      aria-label="Suggest something else"
                    >
                      <Shuffle size={15} aria-hidden /> Other
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="td-now-top">
                  <span className="td-kicker">
                    {reviewTopic
                      ? "Nothing urgent · worth reviewing"
                      : "All done"}
                  </span>
                  {windowText && (
                    <span className="td-now-window">{windowText}</span>
                  )}
                </div>
                {reviewTopic ? (
                  <h2 className="td-now-title">Review {reviewTopic.title}</h2>
                ) : (
                  <Swish>
                    <strong className="td-now-title">
                      Nothing needs doing right now.
                    </strong>
                  </Swish>
                )}
                {reviewTopic && (
                  <div className="td-actions">
                    <Link
                      href={`/areas/academics?course=${reviewTopic.course_id}`}
                      className="td-btn td-btn-light"
                    >
                      Open {reviewCourse ?? "course"}{" "}
                      <ArrowRight size={15} aria-hidden />
                    </Link>
                  </div>
                )}
              </>
            )}
          </section>

          {wrap.show && (wrap.done.length > 0 || wrap.open.length > 0) && (
            <section className="td-card" aria-label="Wrap up today">
              <div className="td-card-head">
                <h2 className="td-card-title">Wrap up today</h2>
                <span className="td-muted">
                  {wrap.done.length} done · {wrap.open.length} still open
                </span>
              </div>
              {wrap.open.map(({ task, overdue, autoRescheduled }) => (
                <div
                  key={task.id}
                  className={`td-nudge ${leaving.isLeaving(task.id) ? "lv-leaving" : ""}`}
                >
                  <div>
                    <span
                      className={`td-nudge-kicker ${overdue ? "td-hot" : ""}`}
                    >
                      {overdue
                        ? "OVERDUE"
                        : task.status === "in_progress"
                          ? "IN PROGRESS"
                          : "DUE TODAY"}
                    </span>
                    <strong>{task.title}</strong>
                    {autoRescheduled && (
                      <span className="td-muted">
                        Life OS will reschedule it
                      </span>
                    )}
                  </div>
                  <div className="td-actions">
                    <button
                      className="td-btn td-btn-dark td-btn-sm"
                      disabled={!!busy}
                      onClick={() =>
                        void leaving.run(task.id, () => completeTask(task))
                      }
                      aria-label={`Close out ${task.title}`}
                    >
                      <Check size={14} aria-hidden /> Done
                    </button>
                    {!autoRescheduled && (
                      <button
                        className="td-btn td-btn-outline td-btn-sm"
                        disabled={!!busy}
                        onClick={() => void scheduleTask(task)}
                      >
                        Find time
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {wrap.done.length > 0 && (
                <p className="td-muted td-wrap-done">
                  Done today:{" "}
                  {wrap.done
                    .slice(0, 4)
                    .map((t) => t.title)
                    .join(" · ")}
                  {wrap.done.length > 4
                    ? ` · +${wrap.done.length - 4} more`
                    : ""}
                </p>
              )}
            </section>
          )}

          {clash && (
            <section className="td-card td-card-warn" aria-label="Heads up">
              <div className="td-warn-row">
                <span className="td-warn-icon" aria-hidden>
                  <AlertTriangle size={18} />
                </span>
                <div>
                  <h2 className="td-card-title">
                    Two things at {fmt(clash.at)}
                  </h2>
                  <p className="td-muted">
                    {clash.a.title} ({clock(clash.a.start)}–{fmt(clash.a.end)})
                    runs into {clash.b.title}.
                    {clash.nextFree
                      ? ` ${clock(clash.nextFree.start)}–${fmt(clash.nextFree.end)} is free if you want to move one.`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="td-actions">
                <a
                  className="td-btn td-btn-dark"
                  href={`https://calendar.google.com/calendar/r/day/${today.replaceAll("-", "/")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Fix in Google Calendar <ArrowRight size={15} aria-hidden />
                </a>
                <button
                  className="td-btn td-btn-ghost"
                  onClick={() =>
                    void acceptOverlap(overlapKey(clash.a, clash.b)).catch(() =>
                      notify("Couldn’t save that. Try again."),
                    )
                  }
                >
                  It’s fine
                </button>
              </div>
            </section>
          )}

          <section className="td-card shape-river" aria-label="Today’s plan">
            <div className="td-card-head">
              <h2 className="td-card-title">Today’s plan</h2>
              <Link href="/planner?section=calendar" className="td-link">
                Week <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
            {agenda.allDay.length > 0 && (
              <div className="td-chips td-allday">
                {agenda.allDay.map((t) => (
                  <span key={t} className="td-chip td-chip-soft">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {agenda.timeline.length === 0 && (
              <p className="td-muted">
                {hasCalendars
                  ? "No commitments or suggested work today."
                  : "Connect Google Calendar in Settings to see your day here."}
              </p>
            )}
            <ol className="td-timeline river">
              {agenda.timeline.map((e, i) => {
                const past = e.end <= now.getTime();
                const current = e.start <= now.getTime() && !past;
                const area =
                  e.kind === "event"
                    ? areaOf(e.title, "", e.meta)
                    : areaOf(e.item.title, e.item.label);
                const prevEnd = i > 0 ? agenda.timeline[i - 1].end : null;
                const gapStart = prevEnd ?? null;
                const gap =
                  gapStart !== null &&
                  e.start - gapStart >= 45 * 60000 &&
                  e.start > now.getTime()
                    ? Math.round(
                        (e.start - Math.max(gapStart, now.getTime())) / 60000,
                      )
                    : 0;
                return [
                  gap >= 45 ? (
                    <li key={e.id + ":gap"} className="river-gap" aria-hidden>
                      <span>{minutesLabel(gap)} free</span>
                    </li>
                  ) : null,
                  <li
                    key={e.id}
                    className={`area-${area} ${past ? "td-past" : ""} ${current ? "river-now" : ""}`}
                  >
                    <time className="td-time">{clock(e.start)}</time>
                    {e.kind === "event" ? (
                      <div
                        className={`td-event ${e.clash ? "td-event-clash" : ""}`}
                      >
                        <strong>{e.title}</strong>
                        <span>
                          {e.meta} · until {fmt(e.end)}
                          {e.clash && <em> · overlaps</em>}
                        </span>
                      </div>
                    ) : (
                      <button
                        className={`td-work ${e.planned ? "td-work-planned" : ""}`}
                        disabled={
                          !focus?.canStart || !!session || !!busy || past
                        }
                        onClick={() =>
                          void startWork(
                            e.item,
                            Math.round((e.end - e.start) / 60000),
                          )
                        }
                        aria-label={`Start ${e.item.title}`}
                      >
                        <span className="td-work-icon" aria-hidden>
                          <Play size={13} />
                        </span>
                        <span className="td-work-text">
                          <strong>
                            {e.item.title}
                            {e.parts > 1 ? ` (part ${e.part})` : ""}
                          </strong>
                          <span>
                            {e.planned ? "Planned" : "Suggested"} ·{" "}
                            {Math.round((e.end - e.start) / 60000)} min ·{" "}
                            {e.item.label} ·{" "}
                            {dueLabel(e.item)[0].toLowerCase() +
                              dueLabel(e.item).slice(1)}
                          </span>
                        </span>
                      </button>
                    )}
                  </li>,
                ];
              })}
            </ol>
            {work.length > 0 && (
              <p className="td-legend">
                <span className="td-key td-key-event" aria-hidden /> From your
                calendar
                <span className="td-key td-key-work" aria-hidden /> Suggested
                work · tap to start
              </p>
            )}
          </section>

          <section className="td-card" aria-label="This week">
            <div className="td-card-head">
              <h2 className="td-card-title">This week</h2>
              <span className="td-muted">
                {fmt(agenda.week.start, "MMM d")}–{fmt(agenda.week.end, "d")}
              </span>
            </div>
            <WeekFitLine
              now={now}
              policy={b.planning.policy}
              tasks={data.tasks}
            />
            <ol className="skyline" aria-label="How full each day is">
              {skyline.map((d) => (
                <li
                  key={d.date}
                  className={`${d.date < agenda.today ? "past" : ""} ${d.date === agenda.today ? "today" : ""}`}
                >
                  <div
                    className="bar"
                    style={{
                      height: `${Math.max(4, (d.busyMinutes / busiest) * 100)}%`,
                    }}
                    title={`${d.events} events · ${minutesLabel(d.busyMinutes)} busy`}
                  >
                    {d.pins[0] && (
                      <span className="pin">
                        {d.pins[0]}
                        {d.pins.length > 1 ? ` +${d.pins.length - 1}` : ""}
                      </span>
                    )}
                  </div>
                  <span className="label">
                    <b>{fmt(Date.parse(d.date + "T20:00:00Z"), "EEE")}</b>
                    <small>
                      {d.events
                        ? `${d.events} event${d.events === 1 ? "" : "s"}`
                        : "open"}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
            <div className="headline-numbers week-numbers">
              <div className="area-study">
                <b>{(agenda.week.focusMinutes / 60).toFixed(1)}h</b>
                <span>Focus time logged</span>
                <RhythmDots
                  days={weekDays}
                  filled={b.weekly.focus_days ?? []}
                  today={agenda.today}
                />
              </div>
              <div className="area-school">
                <b>
                  {agenda.week.deadlinesDone}
                  <small> of {agenda.week.deadlinesTotal}</small>
                </b>
                <span>Deadlines cleared</span>
              </div>
              <div className="area-career">
                <b>
                  {agenda.week.goalsMoved}
                  <small> of {agenda.week.goalsTotal}</small>
                </b>
                <span>Goals moved forward</span>
              </div>
            </div>
            {graded.length > 0 && (
              <p className="td-muted td-small">
                Latest results:{" "}
                {graded
                  .map(
                    (a) =>
                      `${a.course} ${a.title} ${
                        a.score_unit === "percent"
                          ? a.earned_score
                          : Math.round(
                              (a.earned_score! / a.maximum_score!) * 1000,
                            ) / 10
                      }%`,
                  )
                  .join(" · ")}
              </p>
            )}
          </section>
        </div>

        <div className="td-col">
          <MailChangesCard
            courseCode={(id) =>
              b.assessments.find((a) => a.course_id === id)?.course
            }
          />

          <section
            className="td-card area-paper area-school"
            aria-label="Due this week"
          >
            <div className="td-card-head">
              <h2 className="td-card-title">Due this week</h2>
              <Link href="/areas/academics" className="td-link">
                School <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
            {b.source_errors.includes("academics") ? (
              <p className="td-muted">
                Deadlines couldn’t load. Pull to refresh in a moment.
              </p>
            ) : agenda.due.length === 0 ? (
              <p className="td-muted">Nothing due in the next seven days.</p>
            ) : (
              <>
                {openDue.length === 0 && (
                  <Swish>Everything due this week is handed in.</Swish>
                )}
                <ul className="td-due">
                  {openDue.map((d) => (
                    <li key={d.key}>
                      <Link
                        href={d.href}
                        className={d.status === "done" ? "td-done" : undefined}
                      >
                        <span
                          className={`td-badge ${d.urgent ? "td-badge-hot" : ""}`}
                        >
                          <b>{dayBadge(d.due, now)}</b>
                          <small>
                            {fmt(d.due, "h:mma")
                              .replace(":00", "")
                              .toLowerCase()}
                          </small>
                        </span>
                        <span className="td-due-text">
                          <strong>{d.title}</strong>
                          <span>
                            {d.label} ·{" "}
                            {d.status === "done"
                              ? "handed in"
                              : d.status === "planned"
                                ? `planned ${fmt(d.plannedAt!)} today`
                                : "not planned yet"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {handedIn > 0 && (
                  <p className="td-muted td-handed">
                    <Check size={14} aria-hidden /> {handedIn} handed in this
                    week
                  </p>
                )}
              </>
            )}
          </section>

          <FollowUpNudge />

          {(nudgeOverdue || nudgeStep || quickWins.length > 0) && (
            <section
              className="td-card area-paper area-career"
              aria-label="Keep your goals moving"
            >
              <div className="td-card-head">
                <h2 className="td-card-title">Keep your goals moving</h2>
                <Link href="/goals" className="td-link">
                  Growth <ArrowRight size={14} aria-hidden />
                </Link>
              </div>
              {quickWins.map((t) => (
                <div
                  key={t.id}
                  className={`td-nudge ${leaving.isLeaving(t.id) ? "lv-leaving" : ""}`}
                >
                  <div>
                    <span className="td-nudge-kicker">
                      QUICK WIN · FROM YOUR INBOX
                    </span>
                    <strong>{t.title}</strong>
                  </div>
                  <button
                    className="td-btn td-btn-dark td-btn-sm"
                    disabled={!!busy}
                    onClick={() =>
                      void leaving.run(t.id, () => completeTask(t))
                    }
                  >
                    <Check size={14} aria-hidden /> Done
                  </button>
                </div>
              ))}
              {nudgeOverdue && nudgeOverdue.kind === "overdue" && (
                <div className="td-nudge td-nudge-warn">
                  <div>
                    <span className="td-nudge-kicker td-hot">
                      {nudgeOverdue.daysLate} DAY
                      {nudgeOverdue.daysLate === 1 ? "" : "S"} PAST TARGET
                    </span>
                    <strong>{nudgeOverdue.goal.title}</strong>
                    <span className="td-muted">
                      Still a priority this term?
                    </span>
                  </div>
                  <div className="td-actions">
                    <button
                      className="td-btn td-btn-dark td-btn-sm"
                      disabled={!!busy}
                      onClick={() =>
                        void updateGoal(
                          nudgeOverdue.goal,
                          { target_date: plusDays(today, 14) },
                          `Moved to ${shortDay(plusDays(today, 14))}`,
                        )
                      }
                    >
                      Move to {shortDay(plusDays(today, 14))}
                    </button>
                    <button
                      className="td-btn td-btn-ghost td-btn-sm"
                      disabled={!!busy}
                      onClick={() =>
                        void updateGoal(
                          nudgeOverdue.goal,
                          { status: "paused" },
                          "Goal paused",
                        )
                      }
                    >
                      Pause it
                    </button>
                  </div>
                </div>
              )}
              {nudgeStep && (
                <form
                  className="td-nudge td-nudge-form"
                  onSubmit={(e) => void addNextStep(nudgeStep.goal, e)}
                >
                  <div>
                    <span className="td-nudge-kicker">NO NEXT STEP YET</span>
                    <strong>{nudgeStep.goal.title}</strong>
                  </div>
                  <div className="td-inline">
                    <label
                      className="sr-only"
                      htmlFor={`step-${nudgeStep.goal.id}`}
                    >
                      Next step for {nudgeStep.goal.title}
                    </label>
                    <input
                      id={`step-${nudgeStep.goal.id}`}
                      name="step"
                      placeholder="One small action, e.g. a 20-min lesson"
                      autoComplete="off"
                    />
                    <button
                      className="td-btn td-btn-dark td-btn-sm"
                      disabled={!!busy}
                    >
                      Add
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
