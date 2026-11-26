"use client";
import { ReconnectGoogle, needsReconnect } from "./reconnect-google";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { addDays, format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  CalendarDays,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  RefreshCw,
  Trophy,
} from "lucide-react";
import { calendarRequest, useCalendar } from "./use-calendar";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { PlanningDecisions } from "./planning-decisions";
import { eventOnDate, eventTimeLabel } from "@/lib/integrations/calendar-view";
import {
  groupCalendarEvents,
  layoutDay,
  readableDay,
  type EventGroup,
} from "@/lib/integrations/calendar-layout";
import {
  calendarKind,
  calendarKindLabel,
  sessionOverlaps,
} from "@/lib/integrations/calendar-display";
import {
  dayLoad,
  eventStyle,
  freeWindows,
  GAME_AFTER,
  GAME_BEFORE,
  minutesLabel,
  TONES,
  type Tone,
} from "@/lib/calendar-style";
import { isGame } from "@/lib/basketball";
import { localDate } from "@/lib/dates";
import type { Task } from "@/lib/schemas";

/** Pixels per hour and per minute in the week and day grids. */
const HOUR = 52;
const MINUTE = HOUR / 60;
const ZONE = "America/Vancouver";
const VIEWS = ["day", "week", "month", "agenda"] as const;

/** Timed events this long ("Off Day", camps) read better in the all-day row. */
function isLong(g: EventGroup) {
  const { start_at, end_at } = g.event;
  return (
    !!start_at &&
    !!end_at &&
    Date.parse(end_at) - Date.parse(start_at) >= 10 * 3600000
  );
}

type Deadline = {
  canvas_id: string;
  title: string;
  due_at: string;
  course_code: string | null;
  submission_state: string;
};

const minuteOf = (iso: string) => {
  const [h, m] = formatInTimeZone(iso, ZONE, "H:m").split(":").map(Number);
  return h * 60 + m;
};

function rangeTitle(view: string, days: Date[], anchor: Date) {
  if (view === "month") return format(anchor, "MMMM yyyy");
  if (view === "week") {
    const a = days[0],
      b = days.at(-1)!;
    return a.getMonth() === b.getMonth()
      ? `${format(a, "MMM d")} – ${format(b, "d, yyyy")}`
      : `${format(a, "MMM d")} – ${format(b, "MMM d, yyyy")}`;
  }
  return format(anchor, "EEE, MMM d");
}

function dueWhen(iso: string, today: string) {
  const day = localDate(iso);
  const time = formatInTimeZone(iso, ZONE, "h:mm a");
  if (day === today) return `Due today ${time}`;
  if (day === localDate(addDays(new Date(today + "T12:00:00"), 1)))
    return `Due tomorrow ${time}`;
  return `Due ${time}`;
}

export function PlannerCalendar({
  days,
  view,
  anchor,
  tasks,
  onTask,
  onDay,
  onNavigate,
  onToday,
  onView,
  onNewTask,
  onMoveTask,
}: {
  days: Date[];
  view: string;
  anchor: Date;
  tasks: Task[];
  onTask: (task: Task) => void;
  onDay: (day: Date) => void;
  onNavigate: (direction: number) => void;
  onToday: () => void;
  onView: (view: string) => void;
  onNewTask: (dueAt: string) => void;
  onMoveTask: (task: Task, day: string) => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const today = localDate(new Date(now));
  const nowMinute = minuteOf(new Date(now).toISOString());
  const from = format(days[0], "yyyy-MM-dd");
  const until = format(addDays(days.at(-1)!, 1), "yyyy-MM-dd");
  const { data, events, error, busy, message, setMessage, sync, reload } =
    useCalendar(from, until);
  const [menu, setMenu] = useState(false),
    [hidden, setHidden] = useState<string[]>([]),
    [group, setGroup] = useState(true),
    [kind, setKind] = useState("all"),
    [details, setDetails] = useState<EventGroup | null>(null),
    [dayDetail, setDayDetail] = useState<string | null>(null),
    [deadlines, setDeadlines] = useState<Deadline[]>([]),
    [window_, setWindow] = useState({ start: 9, end: 21 }),
    [drag, setDrag] = useState<{
      id: string;
      delta: number;
      day: string;
    } | null>(null),
    [moving, setMoving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !menuRef.current?.contains(e.target as Node)
      )
        setMenu(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [menu]);
  const restored = useRef("");
  // The planning window (free time is only counted inside it).
  useEffect(() => {
    let live = true;
    void calendarRequest<{
      policy?: { start_hour?: number; end_hour?: number };
    }>("/api/v1/schedule/automation")
      .then((s) => {
        if (live && s.policy?.start_hour !== undefined)
          setWindow({
            start: s.policy.start_hour,
            end: s.policy.end_hour ?? 21,
          });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // Canvas deadlines for the visible days sit on the grid itself.
  useEffect(() => {
    let live = true;
    void fetch(`/api/canvas/deadlines?from=${from}&until=${until}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then((d: { records?: Deadline[] }) => {
        if (live) setDeadlines(d.records ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [from, until]);
  // T today · ←/→ move · D/W/M/A views.
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (t &&
          (t.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) ||
        document.querySelector("[role=dialog]")
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "t") onToday();
      else if (e.key === "ArrowLeft") onNavigate(-1);
      else if (e.key === "ArrowRight") onNavigate(1);
      else if (k === "d") onView("day");
      else if (k === "w") onView("week");
      else if (k === "m") onView("month");
      else if (k === "a") onView("agenda");
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onToday, onNavigate, onView]);

  const calendars = data?.calendars.filter((c) => c.sync_enabled) ?? [];
  const allGroups = groupCalendarEvents(events, group);
  const groups = groupCalendarEvents(
    events.filter(
      (e) =>
        !hidden.includes(e.calendar_id) &&
        (kind === "all" || calendarKind(e) === kind),
    ),
    group,
  );
  const name = useCallback(
    (id: string) =>
      data?.calendars.find((c) => c.id === id)?.name ?? "Calendar",
    [data],
  );
  const styleOf = (g: EventGroup) =>
    g.event.work_session
      ? { tone: "study" as Tone, label: g.event.title || "Work session" }
      : eventStyle(g.event.title, name(g.event.calendar_id));
  const showDue = kind === "all" || kind === "deadlines";
  const due = (day: string) =>
    showDue
      ? tasks.filter(
          (t) =>
            (t.due_date ?? (t.due_at ? localDate(t.due_at) : null)) === day,
        )
      : [];
  const canvasDue = (day: string) =>
    showDue
      ? deadlines.filter(
          (d) =>
            localDate(d.due_at) === day &&
            !["submitted", "graded", "excused"].includes(d.submission_state),
        )
      : [];
  const on = (day: string) => groups.filter((g) => eventOnDate(g.event, day));
  const timed = (day: string) =>
    on(day).filter((g) => !g.event.all_day_start && !isLong(g));
  const games = (day: string) =>
    timed(day).filter((g) => isGame(g.event.title, name(g.event.calendar_id)));
  const freeOf = (day: string) =>
    day < today
      ? []
      : freeWindows(
          layoutDay(
            allGroups.filter(
              (g) => !isLong(g) && g.event.busy_status !== "free",
            ),
            day,
          ).map((i) => ({ start: i.start, end: i.end })),
          window_.start,
          window_.end,
          day === today ? nowMinute : null,
        );
  // Open at the current time when today is visible, else the first event.
  const firstStart = days
    .flatMap((d) =>
      layoutDay(
        groups.filter((g) => !isLong(g)),
        format(d, "yyyy-MM-dd"),
      ).map((i) => i.start),
    )
    .reduce((a, b) => Math.min(a, b), 8 * 60);
  const showsToday = days.some((d) => format(d, "yyyy-MM-dd") === today);
  useEffect(() => {
    if (!data || !scroller.current || restored.current === view + from) return;
    restored.current = view + from;
    scroller.current.scrollTop = Math.max(
      0,
      // The current time inside the planning window; otherwise the first event.
      (showsToday &&
      nowMinute >= window_.start * 60 &&
      nowMinute < window_.end * 60
        ? nowMinute - 90
        : Math.min(firstStart, window_.start * 60) - 30) * MINUTE,
    );
  }, [view, from, data, firstStart, showsToday, nowMinute, window_]);

  const stamps = calendars
    .map((c) => c.last_synced_at)
    .filter((s): s is string => !!s)
    .sort();
  const last = stamps.length === calendars.length ? stamps[0] : null;
  const failed = calendars.filter((c) => c.sync_error).length;
  const stale =
    !!data &&
    calendars.length > 0 &&
    (!last || now - Date.parse(last) > 26 * 3600000);
  const selectedDay = format(anchor, "yyyy-MM-dd");
  const coverageMissing = calendars.some(
    (c) =>
      !c.coverage_start ||
      !c.coverage_end ||
      localDate(c.coverage_start) > from ||
      localDate(c.coverage_end) < until,
  );
  const tonesShown = [
    ...new Set(
      days.flatMap((d) =>
        timed(format(d, "yyyy-MM-dd")).map((g) => styleOf(g).tone),
      ),
    ),
  ];

  async function moveBlock(g: EventGroup, deltaMinutes: number, toDay: string) {
    const ws = g.event.work_session;
    if (!ws?.version || !g.event.start_at || !g.event.end_at) return;
    const fromDay = localDate(g.event.start_at);
    const shift =
      deltaMinutes * 60000 +
      (Date.parse(fromZonedTime(`${toDay}T12:00:00`, ZONE).toISOString()) -
        Date.parse(fromZonedTime(`${fromDay}T12:00:00`, ZONE).toISOString()));
    if (!shift) return;
    setMoving(true);
    try {
      await calendarRequest("/api/v1/calendar/managed/move", {
        method: "POST",
        body: JSON.stringify({
          action: "move",
          request_id: crypto.randomUUID(),
          block_id: ws.block_id,
          version: ws.version,
          start_at: new Date(
            Date.parse(g.event.start_at) + shift,
          ).toISOString(),
          end_at: new Date(Date.parse(g.event.end_at) + shift).toISOString(),
          confirmed: true,
        }),
      });
      setMessage("Work session moved.");
      await reload();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "That session couldn't move.",
      );
    } finally {
      setMoving(false);
    }
  }

  /** Drag a Life OS work session up/down (and across days in week view). */
  function startDrag(e: React.PointerEvent, g: EventGroup, day: string) {
    if (!g.event.work_session?.version || e.button !== 0) return;
    const startY = e.clientY;
    let moved = false;
    let state = { id: g.id, delta: 0, day };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientY - startY) / MINUTE / 15) * 15;
      const col = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find((el) => el instanceof HTMLElement && el.dataset.day) as
        HTMLElement | undefined;
      const nextDay = col?.dataset.day ?? day;
      if (Math.abs(ev.clientY - startY) > 4 || nextDay !== day) moved = true;
      state = { id: g.id, delta, day: nextDay };
      if (moved) setDrag(state);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDrag(null);
      if (moved) {
        target.dataset.dragged = "1";
        void moveBlock(g, state.delta, state.day);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  /** A click on empty grid time starts a task there (rounded to 15 min). */
  function addAt(e: React.MouseEvent<HTMLDivElement>, day: string) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.free)
      return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = Math.max(
      0,
      Math.min(
        23 * 60 + 45,
        Math.round((e.clientY - rect.top) / MINUTE / 15) * 15,
      ),
    );
    const hh = String(Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    onNewTask(fromZonedTime(`${day}T${hh}:${mm}:00`, ZONE).toISOString());
  }

  const dueChips = (day: string, max: number) => {
    const list = [
      ...canvasDue(day).map((d) => (
        <span
          key={"c" + d.canvas_id}
          className="cal-due"
          title={`${d.course_code ?? ""} ${d.title} · ${dueWhen(d.due_at, today)}`}
        >
          {d.course_code ? <b>{d.course_code}</b> : null} {d.title}
        </span>
      )),
      ...due(day).map((t) => (
        <button
          key={t.id}
          className="cal-due cal-due-task"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}
          onClick={() => onTask(t)}
          title={`${t.title}${t.due_at ? " · " + dueWhen(t.due_at, today) : ""}. Drag to another day to move it.`}
        >
          {t.title}
        </button>
      )),
    ];
    return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
  };
  const dropTask = (day: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("text/task")) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData("text/task");
      const t = tasks.find((x) => x.id === id);
      if (t) {
        e.preventDefault();
        void onMoveTask(t, day);
      }
    },
  });

  const eventChip = (g: EventGroup) => {
    const s = styleOf(g);
    return (
      <button
        key={g.id}
        className={`calendar-event-chip tone-${s.tone}`}
        onClick={() => {
          setDayDetail(null);
          setDetails(g);
        }}
        title={`${g.event.title} · ${eventTimeLabel(g.event)} · ${g.sources.map((x) => name(x.calendar_id)).join(", ")}`}
      >
        {g.event.all_day_start || isLong(g)
          ? ""
          : formatInTimeZone(g.event.start_at!, ZONE, "h:mm") + " "}
        {s.label}
      </button>
    );
  };
  const dayRows = (day: string) =>
    on(day).map((g) => {
      const s = styleOf(g);
      return (
        <button
          className="agenda-compact-row"
          key={g.id}
          onClick={() => {
            setDayDetail(null);
            setDetails(g);
          }}
        >
          <time>
            {g.event.all_day_start
              ? "All day"
              : formatInTimeZone(g.event.start_at!, ZONE, "h:mm a")}
          </time>
          <span className="agenda-row-content">
            <strong>{s.label}</strong>
            <small>
              {eventTimeLabel(g.event)} ·{" "}
              {g.sources.map((x) => name(x.calendar_id)).join(", ")}
            </small>
          </span>
          <span className={`calendar-source-dot tone-dot tone-${s.tone}`} />
        </button>
      );
    });
  const dueRows = (day: string) => [
    ...canvasDue(day).map((d) => (
      <div className="agenda-compact-row agenda-due" key={"c" + d.canvas_id}>
        <time>{formatInTimeZone(d.due_at, ZONE, "h:mm a")}</time>
        <span className="agenda-row-content">
          <strong>
            {d.course_code ? `${d.course_code} · ` : ""}
            {d.title}
          </strong>
          <small>{dueWhen(d.due_at, today)}</small>
        </span>
      </div>
    )),
    ...due(day).map((t) => (
      <button
        className="agenda-compact-row agenda-due"
        key={t.id}
        onClick={() => onTask(t)}
      >
        <time>Due</time>
        <strong>{t.title}</strong>
      </button>
    )),
  ];

  const problem =
    error ||
    needsReconnect(calendars.map((c) => c.sync_error)) ||
    failed > 0 ||
    stale;

  return (
    <div className="planner-calendar cal">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous period"
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeft size={15} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next period"
            onClick={() => onNavigate(1)}
          >
            <ChevronRight size={15} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onToday}>
            Today
          </Button>
          <h2 className="cal-range">{rangeTitle(view, days, anchor)}</h2>
        </div>
        <div className="cal-actions">
          <div className="segmented" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                aria-pressed={view === v}
                onClick={() => onView(v)}
                title={`${v[0].toUpperCase() + v.slice(1)} (${v[0].toUpperCase()})`}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="cal-menu-wrap" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Calendar options"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={16} />
            </Button>
            {menu && (
              <div
                className="cal-menu"
                role="dialog"
                aria-label="Calendar options"
              >
                <p className="cal-menu-label">Show</p>
                <div className="cal-menu-kinds" aria-label="Event types">
                  {[
                    ["all", "Everything"],
                    ["commitments", "Commitments"],
                    ["sessions", "Work sessions"],
                    ["deadlines", "Deadlines"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={kind === value}
                      onClick={() => setKind(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!!calendars.length && (
                  <>
                    <p className="cal-menu-label">Calendars</p>
                    <div
                      className="cal-menu-sources"
                      aria-label="Calendar sources"
                    >
                      {calendars.map((c) => (
                        <button
                          key={c.id}
                          aria-pressed={!hidden.includes(c.id)}
                          className={
                            hidden.includes(c.id)
                              ? "source-filter muted"
                              : "source-filter"
                          }
                          onClick={() =>
                            setHidden((old) =>
                              old.includes(c.id)
                                ? old.filter((x) => x !== c.id)
                                : [...old, c.id],
                            )
                          }
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                    <p className="small muted">
                      Hidden calendars still protect your time.
                    </p>
                  </>
                )}
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={group}
                    onChange={(e) => setGroup(e.currentTarget.checked)}
                  />
                  Group matching entries across calendars
                </label>
                <div className="cal-menu-sync">
                  <span className="small muted">
                    {last
                      ? `Synced ${formatInTimeZone(last, ZONE, "MMM d, h:mm a")}`
                      : calendars.length
                        ? "Not synced yet"
                        : "No calendars selected"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Refresh calendar events"
                    disabled={!!busy || !calendars.length}
                    onClick={() => void sync()}
                  >
                    <RefreshCw size={14} className={busy ? "spin" : ""} />{" "}
                    Refresh
                  </Button>
                </div>
                <PlanningDecisions />
                <div className="cal-menu-links">
                  <Link
                    className="text-link"
                    href="/settings?section=integrations"
                  >
                    Sync settings
                  </Link>
                  <Link className="text-link" href="/settings?section=planning">
                    Work hours &amp; sessions
                  </Link>
                </div>
                <p className="small muted cal-keys">
                  Keys: T today · ← → move · D W M A views
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {problem && (
        <div className="calendar-inline-alert error-message" role="alert">
          <span>
            {error ||
              (needsReconnect(calendars.map((c) => c.sync_error))
                ? "Google needs you to sign in again. Events changed in Google since the last sync aren’t shown yet."
                : failed
                  ? `${failed} calendar${failed === 1 ? "" : "s"} couldn't sync. Saved entries may be out of date.`
                  : `Google Calendar hasn't synced since ${last ? formatInTimeZone(last, ZONE, "MMM d, h:mm a") : "it was connected"}.`)}
          </span>
          {needsReconnect([error, ...calendars.map((c) => c.sync_error)]) ? (
            <ReconnectGoogle />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy || !calendars.length}
              onClick={() => void sync()}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {message && (
        <p className="calendar-inline-alert" role="status">
          {message}
        </p>
      )}
      {coverageMissing && !problem && (
        <p className="calendar-inline-alert muted">
          Some dates are outside the synced range. Missing events don’t mean
          free time.
        </p>
      )}
      {!calendars.length && data && (
        <p className="calendar-inline-alert muted">
          Choose calendars in{" "}
          <Link className="text-link" href="/settings?section=integrations">
            Settings
          </Link>{" "}
          to see your schedule.
        </p>
      )}

      {(view === "week" || view === "day") && tonesShown.length > 1 && (
        <div className="cal-legend" aria-label="Colours">
          {TONES.filter((t) => tonesShown.includes(t.tone)).map((t) => (
            <span key={t.tone}>
              <i className={`tone-dot tone-${t.tone}`} aria-hidden /> {t.label}
            </span>
          ))}
        </div>
      )}

      {view === "month" ? (
        <div className="month-calendar">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div className="month-weekday" key={d}>
              {d}
            </div>
          ))}
          {days.map((d) => {
            const key = format(d, "yyyy-MM-dd");
            const list = on(key);
            const chips = dueChips(key, 1);
            const extra = Math.max(0, list.length - 2) + chips.more;
            return (
              <div
                key={key}
                {...dropTask(key)}
                className={`month-cell ${d.getMonth() !== anchor.getMonth() ? "outside" : ""} ${key === today ? "is-today" : ""}`}
              >
                <button
                  className="month-date"
                  onClick={() => {
                    onDay(d);
                    setDayDetail(key);
                  }}
                  aria-label={format(d, "EEEE, MMMM d")}
                >
                  {d.getDate()}
                  {games(key).length > 0 && (
                    <Trophy
                      size={11}
                      aria-label="Game day"
                      className="cal-game-icon"
                    />
                  )}
                </button>
                {list.slice(0, 2).map((g) => eventChip(g))}
                {chips.shown}
                {extra > 0 && (
                  <button
                    className="calendar-more"
                    onClick={() => setDayDetail(key)}
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : view === "agenda" ? (
        <div className="compact-agenda">
          <div className="agenda-date-heading">
            <h3>{format(anchor, "EEEE, MMMM d")}</h3>
            <span className="muted small">
              {dayLoad(
                timed(selectedDay).length,
                freeOf(selectedDay).reduce((n, f) => n + f.end - f.start, 0),
                selectedDay < today,
              )}
            </span>
          </div>
          {dueRows(selectedDay)}
          {dayRows(selectedDay)}
          {!on(selectedDay).length && !dueRows(selectedDay).length && (
            <p className="calendar-empty">
              <CalendarDays size={24} />
              {kind !== "all" || hidden.length
                ? "Nothing matches what you chose to show."
                : "Nothing on this day."}
            </p>
          )}
        </div>
      ) : (
        <>
          {(view === "day" || view === "week") && (
            <div
              className={`cal-strip ${view === "week" ? "mobile-week-picker" : ""}`}
              aria-label="Choose a day"
            >
              {Array.from({ length: 7 }, (_, i) =>
                addDays(addDays(anchor, -((anchor.getDay() + 6) % 7)), i),
              ).map((d) => {
                const key = format(d, "yyyy-MM-dd");
                return (
                  <button
                    key={key}
                    className={`${key === selectedDay ? "active" : ""} ${key === today ? "is-today" : ""}`}
                    aria-pressed={key === selectedDay}
                    aria-label={format(d, "EEEE, MMMM d")}
                    onClick={() => onDay(d)}
                  >
                    <span>{format(d, "EEEEE")}</span>
                    <strong>{format(d, "d")}</strong>
                    {games(key).length > 0 && (
                      <i className="cal-strip-game" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div
            className="time-calendar"
            style={{ "--days": days.length } as React.CSSProperties}
          >
            <div className="time-grid-header">
              <div className="time-axis-label" aria-hidden />
              {days.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const free = freeOf(key).reduce(
                  (n, f) => n + f.end - f.start,
                  0,
                );
                const game = games(key)[0];
                return (
                  <button
                    key={key}
                    className={`time-day-heading ${key === today ? "is-today" : ""} ${key === selectedDay ? "selected-mobile" : ""}`}
                    onClick={() => {
                      onDay(d);
                      setDayDetail(key);
                    }}
                    aria-label={`Open schedule for ${format(d, "EEEE, MMMM d")}`}
                  >
                    <span className="cal-day-name">
                      {format(d, "EEE")} <strong>{format(d, "d")}</strong>
                    </span>
                    <span
                      className={`cal-day-load ${free < 60 && key >= today && timed(key).length ? "busy" : ""}`}
                    >
                      {game ? (
                        <span className="cal-game">
                          <Trophy size={11} aria-hidden /> Game
                        </span>
                      ) : (
                        dayLoad(timed(key).length, free, key < today)
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="all-day-grid">
              <span className="time-axis-label">All day</span>
              {days.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const all = on(key).filter(
                  (g) => g.event.all_day_start || isLong(g),
                );
                const chips = dueChips(key, view === "day" ? 6 : 2);
                const extra = Math.max(0, all.length - 2) + chips.more;
                return (
                  <div
                    key={key}
                    {...dropTask(key)}
                    className={key === selectedDay ? "selected-mobile" : ""}
                  >
                    {all.slice(0, 2).map((g) => eventChip(g))}
                    {chips.shown}
                    {extra > 0 ? (
                      <button
                        className="calendar-more"
                        onClick={() => setDayDetail(key)}
                      >
                        +{extra} more
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div
              className="time-grid-scroll"
              ref={scroller}
              tabIndex={0}
              aria-label="Calendar time grid"
            >
              <div className="time-grid-body">
                <div className="time-axis">
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} style={{ top: h * HOUR }}>
                      {h === 0
                        ? ""
                        : h < 12
                          ? `${h} AM`
                          : h === 12
                            ? "12 PM"
                            : `${h - 12} PM`}
                    </span>
                  ))}
                </div>
                {days.map((d) => {
                  const day = format(d, "yyyy-MM-dd");
                  const overlaps = sessionOverlaps(allGroups, day);
                  return (
                    <div
                      key={day}
                      data-day={day}
                      className={`time-day-column ${day === today ? "is-today" : ""} ${day === selectedDay ? "selected-mobile" : ""}`}
                      onClick={(e) => addAt(e, day)}
                      title="Click empty time to add a task"
                    >
                      {freeOf(day).map((f) => (
                        <div
                          key={f.start}
                          data-free="1"
                          className="cal-free"
                          style={{
                            top: f.start * MINUTE,
                            height: (f.end - f.start) * MINUTE,
                          }}
                        >
                          {f.end - f.start >= 60 && (
                            <span data-free="1">
                              {minutesLabel(f.end - f.start)} free
                            </span>
                          )}
                        </div>
                      ))}
                      {games(day).map((g) => {
                        const s = minuteOf(g.event.start_at!),
                          e = minuteOf(g.event.end_at!);
                        return [
                          <div
                            key={g.id + "b"}
                            className="cal-buffer"
                            aria-hidden
                            style={{
                              top: Math.max(0, s - GAME_BEFORE) * MINUTE,
                              height: Math.min(GAME_BEFORE, s) * MINUTE,
                            }}
                          />,
                          <div
                            key={g.id + "a"}
                            className="cal-buffer"
                            aria-hidden
                            style={{
                              top: e * MINUTE,
                              height: GAME_AFTER * MINUTE,
                            }}
                          />,
                        ];
                      })}
                      {day === today && (
                        <div
                          className="cal-now"
                          style={{ top: nowMinute * MINUTE }}
                          aria-hidden
                          title={`Now, ${formatInTimeZone(new Date(now), ZONE, "h:mm a")}`}
                        />
                      )}
                      {readableDay(
                        groups.filter((g) => !isLong(g)),
                        day,
                      ).flatMap((cluster) => {
                        const columns = Math.max(
                          ...cluster.items.map((i) => i.columns),
                        );
                        // Two side by side at most; a denser slot becomes "+N".
                        if (columns <= 2)
                          return cluster.items.map((item) => {
                            const g = item;
                            const s = styleOf(g);
                            const clashesWith = cluster.items.some(
                              (other) =>
                                other.id !== item.id &&
                                other.start < item.end &&
                                item.start < other.end &&
                                !(
                                  item.event.recurring && other.event.recurring
                                ),
                            );
                            const clash = clashesWith || overlaps.has(g.id);
                            const width = `calc((100% - 4px) / ${item.columns})`;
                            const height = Math.max(
                              22,
                              (item.end - item.start) * MINUTE - 2,
                            );
                            const dragging = drag?.id === g.id;
                            const movable = !!g.event.work_session?.version;
                            return (
                              <button
                                key={item.id}
                                className={`time-event tone-${s.tone} ${clash ? "time-event-clash" : ""} ${g.event.work_session ? "cal-session" : ""} ${dragging ? "cal-dragging" : ""} ${height < 34 ? "cal-short" : ""}`}
                                aria-label={`${g.event.title} · ${calendarKindLabel(g.event)} · ${eventTimeLabel(g.event)} · ${g.sources.map((src) => name(src.calendar_id)).join(", ")}${clashesWith ? " · Overlaps another event" : overlaps.has(g.id) ? " · Overlaps a busy entry" : ""}${movable ? " · Drag to move" : ""}`}
                                disabled={moving && movable}
                                onPointerDown={(e) => startDrag(e, g, day)}
                                onClick={(e) => {
                                  const el = e.currentTarget;
                                  if (el.dataset.dragged) {
                                    delete el.dataset.dragged;
                                    return;
                                  }
                                  setDayDetail(null);
                                  setDetails(g);
                                }}
                                title={`${g.event.title} · ${eventTimeLabel(g.event)}${movable ? " · drag to move" : ""}`}
                                style={{
                                  top: item.start * MINUTE,
                                  height,
                                  left: `calc(2px + ${width} * ${item.column})`,
                                  width: `calc(${width} - 2px)`,
                                  transform: dragging
                                    ? `translateY(${drag!.delta * MINUTE}px)`
                                    : undefined,
                                }}
                              >
                                {clash && (
                                  <AlertTriangle
                                    size={11}
                                    className="calendar-overlap-icon"
                                    aria-hidden
                                  />
                                )}
                                <strong>{s.label}</strong>
                                {height >= 34 && (
                                  <small>
                                    {dragging && drag!.delta
                                      ? `${drag!.delta > 0 ? "+" : ""}${minutesLabel(Math.abs(drag!.delta))}${drag!.delta < 0 ? " earlier" : " later"}${drag!.day !== day ? ` · ${format(new Date(drag!.day + "T12:00:00"), "EEE")}` : ""}`
                                      : eventTimeLabel(g.event)}
                                  </small>
                                )}
                              </button>
                            );
                          });
                        const g = cluster.items[0];
                        const s = styleOf(g);
                        return [
                          <button
                            key={cluster.id}
                            className={`time-event calendar-overlap-group tone-${s.tone}`}
                            aria-label={`${cluster.items.length} events at once on ${day}. Open full schedule`}
                            onClick={() => {
                              setDetails(null);
                              setDayDetail(day);
                            }}
                            title={cluster.items
                              .map(
                                (i) =>
                                  `${i.event.title} · ${eventTimeLabel(i.event)}`,
                              )
                              .join("\n")}
                            style={{
                              top: cluster.start * MINUTE,
                              height: Math.max(
                                22,
                                (cluster.end - cluster.start) * MINUTE - 2,
                              ),
                              left: 2,
                              width: "calc(100% - 4px)",
                            }}
                          >
                            <strong>{s.label}</strong>
                            <small>
                              +{cluster.items.length - 1} more at the same time
                            </small>
                          </button>,
                        ];
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      {details && (
        <Modal
          title={styleOf(details).label}
          open
          onOpenChange={(open) => {
            if (!open) setDetails(null);
          }}
          description={
            details.event.work_session
              ? "Your scheduled work session."
              : "From your connected calendar."
          }
        >
          <div className="event-detail">
            <span className="badge">
              {details.event.work_session
                ? calendarKindLabel(details.event)
                : "Calendar commitment"}
            </span>
            {details.event.work_session && (
              <>
                <p className="small muted">
                  Life OS reservation · {details.event.work_session.status}.
                  Drag it on the calendar to move it.
                </p>
                <Link className="text-link" href="/settings?section=planning">
                  Manage work session
                </Link>
              </>
            )}
            <p>
              {details.event.all_day_start ??
                formatInTimeZone(
                  details.event.start_at!,
                  ZONE,
                  "EEEE, MMMM d, yyyy",
                )}
            </p>
            <strong>{eventTimeLabel(details.event)}</strong>
            {details.sources.length > 1 && (
              <p className="muted small">
                {details.sources.length} matching entries are grouped. Originals
                are kept.
              </p>
            )}
            {details.sources.map((s) => (
              <div className="sync-detail" key={s.id}>
                <strong>{name(s.calendar_id)}</strong>
                <span>{s.busy_status === "busy" ? "Busy" : "Free"}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {dayDetail && (
        <Modal
          title={format(new Date(dayDetail + "T12:00Z"), "EEEE, MMMM d")}
          open
          onOpenChange={(open) => {
            if (!open) setDayDetail(null);
          }}
          description={dayLoad(
            timed(dayDetail).length,
            freeOf(dayDetail).reduce((n, f) => n + f.end - f.start, 0),
            dayDetail < today,
          )}
        >
          <div className="day-detail-list">
            {dueRows(dayDetail)}
            {dayRows(dayDetail)}
            {!on(dayDetail).length && !dueRows(dayDetail).length && (
              <p className="muted">Nothing on this day.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
