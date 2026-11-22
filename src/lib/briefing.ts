import { calendarCoverage } from "./calendar-availability";
import { aggregateSyncHealth, type SyncSource } from "./sync-health";
import { realWorkspace } from "./real-workspace";
import { z } from "zod";
import { addDays, format, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { groupCalendarEvents } from "./integrations/calendar-layout";
import {
  type CalendarEvent,
  type CalendarRecord,
} from "./integrations/calendar-view";
import { goalProgress } from "./insights";
import type { Workspace, Task } from "./schemas";
import { DEFAULT_POLICY, type Policy } from "./scheduler";
export const briefingSettings = z
  .object({
    fallback_name: z.string().trim().max(60).default("there"),
    deadline_days: z.number().int().min(1).max(14).default(3),
    stalled_days: z.number().int().min(7).max(90).default(14),
    weights: z
      .object({
        importance: z.number().int().min(0).max(5).default(3),
        academic: z.number().int().min(0).max(5).default(2),
        fit: z.number().int().min(0).max(5).default(2),
        goals: z.number().int().min(0).max(5).default(1),
        postponements: z.number().int().min(0).max(5).default(1),
      })
      .strict()
      .default({
        importance: 3,
        academic: 2,
        fit: 2,
        goals: 1,
        postponements: 1,
      }),
  })
  .strict();
export type BriefingSettings = z.infer<typeof briefingSettings>;
export type Assessment = {
  id: string;
  title: string;
  course_id: string;
  task_id: string | null;
  due_at: string | null;
  due_date: string | null;
  submission_state: string;
  verification_status: string;
  earned_score: number | null;
  maximum_score: number | null;
  weight: number | null;
  dropped: boolean;
  source_key: string | null;
  source_status: string | null;
  score_unit: "points" | "percent";
};
export type BriefingAction = {
  id: string;
  kind: "defer" | "snooze" | "dismiss";
  task_id: string | null;
  item_key: string;
  fingerprint: string;
  until_at: string | null;
  created_at: string;
};
export type DailyCheckIn = {
  day: string;
  timezone: string;
  accomplishments: string;
  obstacles: string;
  unfinished_commitments: string;
  follow_up: string;
  task_id: string | null;
  goal_id: string | null;
  status: "draft" | "completed" | "skipped";
  version: number;
};
export type BriefingInput = {
  sheet_health?: {
    id: string;
    title: string;
    mode: string;
    last_read_at: string | null;
    last_error: string | null;
  }[];
  workspace: Workspace;
  assessments: Assessment[];
  courses: { id: string; code: string; title: string }[];
  calendars: CalendarRecord[];
  events: CalendarEvent[];
  connections: { id: string; status: string }[];
  canvas: {
    connected: boolean;
    expires_at?: string | null;
    enabled?: boolean;
    last_error?: string | null;
    last_sync_at?: string | null;
    health?: { academic_stale_count: number; retry_error_count: number };
  } | null;
  actions: BriefingAction[];
  blocks: {
    actual_minutes?: number | null;
    id: string;
    task_id: string;
    start_at: string;
    end_at: string;
    status: string;
  }[];
  completions: {
    task_id: string;
    actual_minutes: number;
    reported_at: string;
  }[];
  sessions: {
    course_id: string;
    topic_id: string | null;
    actual_minutes: number | null;
    start_at: string | null;
    created_at: string;
  }[];
  topics: { id: string; course_id: string; title: string; mastery: string }[];
  settings: BriefingSettings;
  policy?: Policy;
  source_errors: string[];
  now?: Date;
  week?: string;
};
export type Attention = {
  id: string;
  fingerprint: string;
  kind: "confirmed" | "possible" | "connection";
  title: string;
  detail: string;
  href: string;
};
export const dayPlus = (day: string, n: number) =>
  format(addDays(new Date(day + "T12:00:00Z"), n), "yyyy-MM-dd");
export function briefingDay(now: Date, zone: string) {
  return formatInTimeZone(now, zone, "yyyy-MM-dd");
}
export function briefingGreeting(
  name: string,
  fallback: string,
  now: Date,
  zone: string,
) {
  const h = Number(formatInTimeZone(now, zone, "H"));
  return `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${name.trim().split(/\s+/)[0] || fallback || "there"}.`;
}
const finished = (status: string) =>
  ["completed", "cancelled"].includes(status);
export function buildBriefing(input: BriefingInput) {
  const w = realWorkspace(input.workspace),
    s = input.settings,
    now = input.now ?? new Date(),
    zone = w.profile.timezone || "America/Vancouver",
    today = briefingDay(now, zone),
    nowMs = now.getTime();
  const week =
      input.week ??
      format(
        startOfWeek(new Date(today + "T12:00:00Z"), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      ),
    weekEnd = dayPlus(week, 7);
  const inWeek = (stamp: string | null) =>
    !!stamp &&
    briefingDay(stamp ? new Date(stamp) : now, zone) >= week &&
    briefingDay(new Date(stamp!), zone) < weekEnd;
  const active = w.tasks.filter((t) => !t.deleted_at && !finished(t.status));
  const due = (t: { due_at: string | null; due_date: string | null }) =>
    t.due_at
      ? Date.parse(t.due_at)
      : t.due_date
        ? fromZonedTime(dayPlus(t.due_date, 1) + "T00:00:00", zone).getTime() -
          1
        : null;
  const taskLate = (t: Task) => {
    const d = due(t);
    return d !== null && d < nowMs;
  };
  const academicFor = (t: Task) =>
    input.assessments.filter((a) => !a.dropped && a.task_id === t.id);
  const submitted = (a: Assessment) =>
    ["submitted", "returned", "excused"].includes(a.submission_state);
  // A linked assessment's known submitted state outranks a stale unfinished import.
  const actionable = active.filter(
    (t) => !academicFor(t).length || !academicFor(t).every(submitted),
  );
  const selected = input.calendars.filter((c) => c.sync_enabled);
  const dayStart = fromZonedTime(today + "T00:00:00", zone).getTime(),
    dayEnd = fromZonedTime(dayPlus(today, 1) + "T00:00:00", zone).getTime();
  const calendarReliable = calendarCoverage({
    calendars: input.calendars,
    connections: input.connections,
    start: dayStart,
    end: dayEnd,
    now: nowMs,
    failed: ["calendar", "work", "scheduling"].some((x) =>
      input.source_errors.includes(x),
    ),
  }).verified;
  const selectedEvents = input.events.filter((e) =>
    selected.some((c) => c.id === e.calendar_id),
  );
  const events = groupCalendarEvents(selectedEvents).map((g) => ({
    ...g.event,
    busy_status: g.sources.some((e) => e.busy_status === "busy")
      ? ("busy" as const)
      : ("free" as const),
  }));
  const interval = (e: CalendarEvent) => ({
    start: e.start_at
      ? Date.parse(e.start_at)
      : fromZonedTime(e.all_day_start + "T00:00:00", e.timezone).getTime(),
    end: e.end_at
      ? Date.parse(e.end_at)
      : fromZonedTime(e.all_day_end + "T00:00:00", e.timezone).getTime(),
  });
  const todayEvents = events.filter((e) => {
    const t = interval(e);
    return t.start < dayEnd && t.end > dayStart;
  });
  const weekStartMs = fromZonedTime(week + "T00:00:00", zone).getTime(),
    weekEndMs = fromZonedTime(weekEnd + "T00:00:00", zone).getTime();
  const weekEvents = events.filter((e) => {
    const t = interval(e);
    return t.start < weekEndMs && t.end > weekStartMs;
  });
  const weekConflicts: { first: string; second: string; date: string }[] = [];
  const weekBusy = weekEvents
    .filter((e) => e.busy_status === "busy")
    .sort((a, b) => interval(a).start - interval(b).start);
  for (let i = 0; i < weekBusy.length; i++)
    for (let j = i + 1; j < weekBusy.length; j++) {
      const a = interval(weekBusy[i]),
        b = interval(weekBusy[j]);
      if (b.start >= a.end) break;
      if (a.start < b.end)
        weekConflicts.push({
          first: weekBusy[i].title,
          second: weekBusy[j].title,
          date: briefingDay(new Date(Math.max(a.start, b.start)), zone),
        });
    }
  const policy = input.policy ?? DEFAULT_POLICY;
  const start = Math.max(
    nowMs + policy.freeze_minutes * 60000,
    fromZonedTime(
      today + `T${String(policy.start_hour).padStart(2, "0")}:00:00`,
      zone,
    ).getTime(),
  );
  const end = fromZonedTime(
    today + `T${String(policy.end_hour).padStart(2, "0")}:00:00`,
    zone,
  ).getTime();
  const busy = [
    ...selectedEvents.filter((e) => e.busy_status === "busy").map(interval),
    ...input.blocks
      .filter((b) => b.status === "planned")
      .map((b) => ({
        start: Date.parse(b.start_at),
        end: Date.parse(b.end_at),
      })),
  ]
    .filter((b) => b.end > start && b.start < end)
    .sort((a, b) => a.start - b.start);
  const free: { start_at: string; end_at: string; minutes: number }[] = [];
  let cursor = start;
  for (const b of busy) {
    const stop = Math.min(end, b.start - policy.break_minutes * 60000);
    if (stop > cursor)
      free.push({
        start_at: new Date(cursor).toISOString(),
        end_at: new Date(stop).toISOString(),
        minutes: Math.floor((stop - cursor) / 60000),
      });
    cursor = Math.max(
      cursor,
      Math.min(end, b.end + policy.break_minutes * 60000),
    );
  }
  if (end > cursor)
    free.push({
      start_at: new Date(cursor).toISOString(),
      end_at: new Date(end).toISOString(),
      minutes: Math.floor((end - cursor) / 60000),
    });
  const todayBlocks = input.blocks.filter(
    (b) =>
      ["planned", "completed"].includes(b.status) &&
      briefingDay(new Date(b.start_at), zone) === today,
  );
  const reservedMinutes = todayBlocks.reduce(
    (n, b) =>
      n + Math.max(0, (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000),
    0,
  );
  const capacity = Math.max(0, policy.max_daily_minutes - reservedMinutes),
    maxFree = calendarReliable
      ? Math.min(capacity, Math.max(0, ...free.map((f) => f.minutes)))
      : null;
  const attention: Attention[] = [];
  const add = (
    id: string,
    kind: Attention["kind"],
    title: string,
    detail: string,
    href: string,
    version: string,
  ) => attention.push({ id, kind, title, detail, href, fingerprint: version });
  for (const name of input.source_errors)
    add(
      `source:${name}`,
      "connection",
      `${name} information unavailable`,
      "This section could not be refreshed. Its absence is not evidence of no work.",
      "/settings?section=integrations",
      name,
    );
  for (const source of input.sheet_health ?? []) {
    if (source.mode === "paused") continue;
    if (
      source.last_error ||
      !source.last_read_at ||
      nowMs - Date.parse(source.last_read_at) > 3 * 3600000
    ) {
      add(
        `sheets:${source.id}`,
        "connection",
        `Spreadsheet needs attention: ${source.title}`,
        source.last_error
          ? "The latest synchronization failed. Your saved records remain available; review source settings before relying on them."
          : "No successful source refresh within three hours is recorded. Saved values may be stale.",
        "/settings?section=integrations",
        `${source.last_read_at}:${source.last_error ?? "stale"}`,
      );
    }
  }
  if (!calendarReliable)
    add(
      "calendar:health",
      "connection",
      "Calendar availability needs verification",
      selected.length
        ? "Cached calendar data is stale, incomplete or disconnected. Free time is unknown."
        : "No calendars are selected. Availability is unknown.",
      "/settings?section=integrations",
      selected
        .map((c) => `${c.id}:${c.sync_error}:${c.last_synced_at}`)
        .join("|"),
    );
  if (
    input.canvas &&
    (!input.canvas.connected ||
      input.canvas.enabled === false ||
      !!input.canvas.last_error ||
      !!input.canvas.health?.academic_stale_count ||
      !!input.canvas.health?.retry_error_count ||
      (!!input.canvas.expires_at &&
        Date.parse(input.canvas.expires_at) <= nowMs))
  )
    add(
      "canvas:health",
      "connection",
      "Canvas connection needs attention",
      input.canvas.expires_at && Date.parse(input.canvas.expires_at) <= nowMs
        ? "The stored token expiry has passed. Replace it securely in Canvas settings."
        : "Canvas data may be stale or synchronization is incomplete. Review its connection status.",
      "/canvas-connect",
      JSON.stringify({
        enabled: input.canvas.enabled,
        error: input.canvas.last_error,
        expired:
          !!input.canvas.expires_at &&
          Date.parse(input.canvas.expires_at) <= nowMs,
        health: input.canvas.health,
      }),
    );
  const connectionIssues = attention.filter((a) => a.kind === "connection");
  const syncSources: SyncSource[] = [
    ...selected.map((c) => ({
      id: `calendar:${c.id}`,
      name: c.name,
      lastSuccess: c.last_synced_at,
      issue:
        c.sync_error ||
        (!calendarReliable ? "Calendar coverage needs verification" : null),
    })),
    ...(input.sheet_health ?? [])
      .filter((s) => s.mode !== "paused")
      .map((s) => ({
        id: `sheets:${s.id}`,
        name: s.title,
        lastSuccess: s.last_read_at,
        issue:
          s.last_error ||
          (!s.last_read_at || nowMs - Date.parse(s.last_read_at) > 3 * 3600000
            ? "Refresh overdue"
            : null),
      })),
    ...(input.canvas
      ? [
          {
            id: "canvas",
            name: "Canvas",
            lastSuccess: input.canvas.last_sync_at ?? null,
            issue:
              connectionIssues.find((a) => a.id === "canvas:health")?.detail ??
              null,
          },
        ]
      : []),
  ];
  if (
    !selected.length &&
    connectionIssues.some((a) => a.id.startsWith("calendar:"))
  )
    syncSources.push({
      id: "calendar:availability",
      name: "Calendar",
      lastSuccess: null,
      issue: "Select calendars to confirm your schedule coverage",
    });
  for (const error of input.source_errors)
    if (!syncSources.some((s) => s.id === `source:${error}`))
      syncSources.push({
        id: `source:${error}`,
        name: error,
        lastSuccess: null,
        issue: "Status could not refresh",
      });
  if (connectionIssues.length) {
    for (let i = attention.length - 1; i >= 0; i--)
      if (attention[i].kind === "connection") attention.splice(i, 1);
    add(
      "connections:health",
      "connection",
      "Connected data needs attention",
      `${syncSources.filter((s) => s.issue).length} sources need checking. Open the connection summary for the cause and affected sources.`,
      "/#connected-data",
      connectionIssues
        .map((a) => a.id + ":" + a.fingerprint)
        .sort()
        .join("|"),
    );
  }
  const syncHealth = aggregateSyncHealth(syncSources);
  const knownAssessments = input.assessments.filter(
    (a) => !a.dropped && !submitted(a),
  );
  for (const a of knownAssessments) {
    const d = due(a);
    if (d === null || d > nowMs + s.deadline_days * 86400000) continue;
    const late = d < nowMs,
      course =
        input.courses.find((c) => c.id === a.course_id)?.code ?? "Course";
    add(
      `assessment:${a.id}`,
      late &&
        a.submission_state === "not_submitted" &&
        a.verification_status !== "unverified"
        ? "confirmed"
        : "possible",
      `${course} · ${a.title}`,
      late
        ? a.submission_state === "not_submitted"
          ? "Recorded as not submitted; deadline has passed."
          : "Deadline has passed; submission status is unknown. Verify before calling it missed."
        : `Deadline approaches ${a.due_date ?? formatInTimeZone(a.due_at!, zone, "MMM d, h:mm a")}. ${a.verification_status === "unverified" ? "Source needs verification." : "Recorded academic deadline."}`,
      "/canvas-materials",
      `${a.due_at ?? a.due_date}:${a.submission_state}:${a.verification_status}`,
    );
    if (
      !late &&
      !input.source_errors.includes("study") &&
      !input.sessions.some(
        (x) =>
          x.course_id === a.course_id &&
          (x.actual_minutes ?? 0) > 0 &&
          Date.parse(x.start_at ?? x.created_at) <= nowMs &&
          briefingDay(new Date(x.start_at ?? x.created_at), zone) >=
            dayPlus(today, -7),
      )
    )
      add(
        `preparation:${a.id}`,
        "possible",
        `Preparation not recorded · ${course}`,
        "No study session is recorded for this course in the last seven days. Exact assessment-topic coverage is unknown.",
        "/areas/academics",
        a.due_at ?? a.due_date ?? "unknown",
      );
  }
  for (const t of actionable.filter(taskLate)) {
    if (academicFor(t).length) continue;
    add(
      `task:${t.id}`,
      ["user", "manual"].includes(t.source_type) ? "confirmed" : "possible",
      t.title,
      "This task remains unfinished after its recorded deadline.",
      "/planner",
      `${t.version}:${t.due_at ?? t.due_date}`,
    );
  }
  for (let i = 0; i < todayEvents.length; i++)
    for (let j = i + 1; j < todayEvents.length; j++) {
      const a = todayEvents[i],
        b = todayEvents[j];
      if (a.busy_status !== "busy" || b.busy_status !== "busy") continue;
      const x = interval(a),
        y = interval(b);
      if (x.start < y.end && y.start < x.end)
        add(
          `overlap:${[a.id, b.id].sort().join(":")}`,
          "possible",
          `${a.title} overlaps ${b.title}`,
          "These cached busy events overlap. Confirm whether both require attendance.",
          "/planner",
          `${x.start}:${x.end}:${y.start}:${y.end}`,
        );
    }
  const deferrals = (id: string) =>
    input.actions.filter(
      (a) =>
        a.kind === "defer" &&
        a.task_id === id &&
        Date.parse(a.created_at) >= nowMs - 14 * 86400000,
    ).length;
  for (const t of actionable)
    if (deferrals(t.id) >= 3)
      add(
        `postponed:${t.id}`,
        "confirmed",
        `Repeatedly deferred · ${t.title}`,
        `You chose Not now ${deferrals(t.id)} times in the last 14 days. This does not count calendar moves.`,
        "/planner",
        String(deferrals(t.id)),
      );
  for (const p of w.projects.filter(
    (p) =>
      p.status === "active" &&
      !p.deleted_at &&
      !p.archived_at &&
      nowMs - Date.parse(p.updated_at) > s.stalled_days * 86400000,
  ))
    add(
      `project:${p.id}`,
      "possible",
      `Check progress · ${p.name}`,
      `The project record has not changed for at least ${s.stalled_days} days; work outside Life OS may be missing.`,
      "/areas/projects",
      p.updated_at,
    );
  const hidden = (id: string, fp: string) =>
    input.actions.some(
      (a) =>
        a.item_key === id &&
        a.fingerprint === fp &&
        (a.kind === "dismiss" ||
          (a.kind === "snooze" &&
            !!a.until_at &&
            Date.parse(a.until_at) > nowMs)),
    );
  const blocked = (t: Task) =>
    w.dependencies.some(
      (d) =>
        d.successor_task_id === t.id &&
        !w.tasks.some(
          (p) =>
            p.id === d.predecessor_task_id &&
            !p.deleted_at &&
            p.status === "completed",
        ),
    );
  const recommendations = actionable
    .filter(
      (t) =>
        !blocked(t) &&
        !input.actions.some(
          (a) =>
            a.kind === "defer" &&
            a.task_id === t.id &&
            !!a.until_at &&
            Date.parse(a.until_at) > nowMs,
        ),
    )
    .map((t) => {
      const deadline = due(t),
        days = deadline === null ? null : (deadline - nowMs) / 86400000,
        urgency =
          days === null
            ? 0
            : days < 0
              ? 4
              : days <= 1
                ? 3
                : days <= s.deadline_days
                  ? 2
                  : 1;
      const academic =
          !!t.course_id ||
          w.areas.some((a) => a.id === t.area_id && a.slug === "academics"),
        assessments = academicFor(t),
        weight = Math.max(
          0,
          ...assessments
            .filter(
              (a) =>
                a.verification_status !== "unverified" && a.weight !== null,
            )
            .map((a) => a.weight!),
        );
      const remaining =
        t.estimated_minutes === null
          ? null
          : t.actual_minutes === null
            ? t.estimated_minutes
            : Math.max(0, t.estimated_minutes - t.actual_minutes);
      const goals = w.goalTasks
        .filter((l) => l.task_id === t.id)
        .flatMap((l) =>
          w.goals.filter((g) => g.id === l.goal_id && g.status === "active"),
        )
        .map((g) => ({ id: g.id, title: g.title }));
      const fits =
          maxFree === null || remaining === null ? null : remaining <= maxFree,
        score =
          t.priority * s.weights.importance +
          (academic ? 1 : 0) * s.weights.academic +
          (weight / 100) * s.weights.academic +
          (fits ? 1 : 0) * s.weights.fit +
          (goals.length ? 1 : 0) * s.weights.goals +
          Math.min(3, deferrals(t.id)) * s.weights.postponements;
      const reasons = [
        days === null
          ? "No deadline recorded"
          : days < 0
            ? "Recorded deadline has passed"
            : `Due ${t.due_date ?? formatInTimeZone(t.due_at!, zone, "MMM d, h:mm a")}`,
        `Importance ${t.priority}/4`,
        ...(academic
          ? [
              weight
                ? `Academic work; verified assessment weight ${weight}%`
                : "Academic work; assessment consequence not quantified",
            ]
          : []),
        remaining === null
          ? "Duration unknown"
          : `${remaining} min ${t.actual_minutes === null ? "estimated; actual effort not recorded" : "remaining from recorded effort"}`,
        maxFree === null
          ? "Calendar availability unknown"
          : fits === null
            ? "Add an estimate to assess fit"
            : fits
              ? "Fits a recorded free window"
              : "Needs splitting or another work window",
        ...(deferrals(t.id) ? [`${deferrals(t.id)} recorded deferrals`] : []),
      ];
      return {
        task_id: t.id,
        title: t.title,
        version: t.version,
        urgency,
        score,
        remaining_minutes: remaining,
        fits,
        reasons,
        goals,
        project_id: t.project_id,
        deadline: t.due_at ?? t.due_date,
        eligible: t.scheduling_mode === "eligible",
      };
    })
    .sort(
      (a, b) =>
        b.urgency - a.urgency ||
        b.score - a.score ||
        (due(w.tasks.find((t) => t.id === a.task_id)!) ?? Infinity) -
          (due(w.tasks.find((t) => t.id === b.task_id)!) ?? Infinity) ||
        a.task_id.localeCompare(b.task_id),
    )
    .slice(0, 3);
  const completed = w.tasks.filter(
    (t) => !t.deleted_at && t.status === "completed" && inWeek(t.completed_at),
  );
  const missed = completed.filter((t) => {
    const d = due(t);
    return d !== null && !!t.completed_at && Date.parse(t.completed_at) > d;
  });
  const weekBlocks = input.blocks.filter(
      (b) => inWeek(b.start_at) && b.status !== "cancelled",
    ),
    work = input.completions.filter((c) => inWeek(c.reported_at));
  return {
    refreshed_at: now.toISOString(),
    today,
    timezone: zone,
    sync_health: syncHealth,
    greeting: briefingGreeting(
      w.profile.display_name,
      s.fallback_name,
      now,
      zone,
    ),
    settings: s,
    summary: {
      commitments: calendarReliable ? todayEvents.length : null,
      academic_tasks: actionable.filter(
        (t) =>
          !!t.course_id ||
          w.areas.some((a) => a.id === t.area_id && a.slug === "academics"),
      ).length,
      approaching_deadlines: input.source_errors.includes("academics")
        ? null
        : knownAssessments.filter((a) => {
            const d = due(a);
            return (
              d !== null &&
              d >= nowMs &&
              d <= nowMs + s.deadline_days * 86400000
            );
          }).length,
      completed_yesterday: w.tasks.filter(
        (t) =>
          !t.deleted_at &&
          t.status === "completed" &&
          t.completed_at &&
          briefingDay(new Date(t.completed_at), zone) === dayPlus(today, -1),
      ).length,
    },
    calendar: {
      reliable: calendarReliable,
      available_minutes: calendarReliable
        ? Math.min(
            capacity,
            free.reduce((n, f) => n + f.minutes, 0),
          )
        : null,
      largest_window_minutes: maxFree,
      free_windows: calendarReliable ? free : [],
      events: todayEvents.map((e) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        all_day_start: e.all_day_start,
      })),
      last_source_sync:
        selected
          .map((c) => c.last_synced_at)
          .filter((x): x is string => !!x)
          .sort()[0] ?? null,
    },
    planning: {
      blocks: input.blocks,
      events: selectedEvents.map((e) => ({
        id: e.id,
        calendar_id: e.calendar_id,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        all_day_start: e.all_day_start,
        all_day_end: e.all_day_end,
        timezone: e.timezone,
        busy_status: e.busy_status,
        work_session: e.work_session,
      })),
      policy,
      calendars: selected,
      connections: input.connections,
    },
    recommendations,
    attention: [...new Map(attention.map((a) => [a.id, a])).values()]
      .filter((a) => !hidden(a.id, a.fingerprint))
      .slice(0, 40),
    attention_total: attention.length,
    weekly: {
      start: week,
      calendar_reliable:
        calendarReliable &&
        selected.every(
          (c) =>
            Date.parse(c.coverage_start!) <= weekStartMs &&
            Date.parse(c.coverage_end!) >= weekEndMs,
        ),
      commitment_count: weekEvents.length,
      commitments: weekEvents.slice(0, 16).map((e) => ({
        title: e.title,
        date: e.start_at
          ? formatInTimeZone(e.start_at, zone, "MMM d, h:mm a")
          : e.all_day_start,
      })),
      conflicts: weekConflicts.slice(0, 8),
      conflict_count: weekConflicts.length,
      projects: w.projects
        .filter((p) => p.status === "active" && !p.deleted_at && !p.archived_at)
        .slice(0, 8)
        .map((p) => ({ id: p.id, name: p.name, target_date: p.target_date })),
      roadmap: w.milestones
        .filter((m) => m.status === "planned")
        .sort((a, b) =>
          (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"),
        )
        .slice(0, 8)
        .map((m) => ({
          id: m.id,
          title: m.title,
          target_date: m.target_date,
          status: m.status,
        })),
      end_exclusive: weekEnd,
      completed_tasks: completed.length,
      completed_on_time:
        completed.filter((t) => due(t) !== null).length - missed.length,
      completed_late: missed.length,
      completed_without_deadline: completed.filter((t) => due(t) === null)
        .length,
      planned_minutes: Math.round(
        weekBlocks.reduce(
          (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000,
          0,
        ),
      ),
      reported_minutes: work.reduce((n, c) => n + c.actual_minutes, 0),
      completed_sessions: work.length,
      reported_academic_minutes: input.sessions
        .filter((x) => inWeek(x.start_at ?? x.created_at))
        .reduce((n, x) => n + (x.actual_minutes ?? 0), 0),
      needs_review: input.topics
        .filter((t) => t.mastery === "needs_review")
        .map((t) => ({ title: t.title, course_id: t.course_id }))
        .slice(0, 8),
      milestones: w.milestones
        .filter((m) => m.status === "completed" && inWeek(m.completed_at))
        .map((m) => ({ id: m.id, title: m.title })),
      goals: w.goals
        .filter((g) => g.status === "active")
        .slice(0, 8)
        .map((g) => ({
          id: g.id,
          title: g.title,
          progress: goalProgress(g, w.milestones).label,
        })),
      deferrals: input.actions.filter(
        (a) => a.kind === "defer" && inWeek(a.created_at),
      ).length,
      coverage:
        "Current task completion timestamps and surviving reservations; historical deleted work, old estimates and unrecorded effort are excluded. Planned sessions use their start date; work uses when effort was reported. No productivity score or planned-task denominator is inferred.",
    },
    assessments: input.assessments
      .filter((a) => !a.dropped)
      .map((a) => ({
        ...a,
        course:
          input.courses.find((c) => c.id === a.course_id)?.code ?? "Course",
      })),
    source_errors: input.source_errors,
  };
}
export type BriefingSnapshot = ReturnType<typeof buildBriefing>;
