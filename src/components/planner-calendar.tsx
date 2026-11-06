"use client";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { RefreshCw, SlidersHorizontal, CalendarDays } from "lucide-react";
import { useCalendar } from "./use-calendar";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { eventOnDate, eventTimeLabel } from "@/lib/integrations/calendar-view";
import {
  groupCalendarEvents,
  layoutDay,
  type EventGroup,
} from "@/lib/integrations/calendar-layout";
import { localDate } from "@/lib/dates";
import type { Task } from "@/lib/schemas";
export function PlannerCalendar({
  days,
  view,
  anchor,
  tasks,
  onTask,
  onDay,
}: {
  days: Date[];
  view: string;
  anchor: Date;
  tasks: Task[];
  onTask: (task: Task) => void;
  onDay: (day: Date) => void;
}) {
  const from = format(days[0], "yyyy-MM-dd");
  const until = format(addDays(days.at(-1)!, 1), "yyyy-MM-dd");
  const { data, events, error, busy, message, sync } = useCalendar(from, until);
  const [filters, setFilters] = useState(false),
    [hidden, setHidden] = useState<string[]>([]),
    [group, setGroup] = useState(true),
    [details, setDetails] = useState<EventGroup | null>(null),
    [dayDetail, setDayDetail] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * 36;
  }, [view]);
  const calendars = data?.calendars.filter((c) => c.sync_enabled) ?? [];
  const groups = groupCalendarEvents(
    events.filter((e) => !hidden.includes(e.calendar_id)),
    group,
  );
  const name = (id: string) =>
    data?.calendars.find((c) => c.id === id)?.name ?? "Calendar";
  const color = (g: EventGroup) =>
    data?.calendars.find((c) => c.id === g.event.calendar_id)?.color ??
    "#407BEE";
  const due = (day: string) =>
    tasks.filter(
      (t) => (t.due_date ?? (t.due_at ? localDate(t.due_at) : null)) === day,
    );
  const on = (day: string) => groups.filter((g) => eventOnDate(g.event, day));
  const stamps = calendars
    .map((c) => c.last_synced_at)
    .filter((s): s is string => !!s)
    .sort();
  const last = stamps.length === calendars.length ? stamps[0] : null;
  const selectedDay = format(anchor, "yyyy-MM-dd");
  const coverageMissing = calendars.some(
    (c) =>
      !c.coverage_start ||
      !c.coverage_end ||
      localDate(c.coverage_start) > from ||
      localDate(c.coverage_end) < until,
  );
  const eventButton = (g: EventGroup, short = false) => (
    <button
      key={g.id}
      className="calendar-event-chip"
      onClick={() => {
        setDayDetail(null);
        setDetails(g);
      }}
      title={`${g.event.title} · ${eventTimeLabel(g.event)} · ${g.sources.map((s) => name(s.calendar_id)).join(", ")}`}
      style={{ borderLeftColor: color(g) }}
    >
      <span>
        {g.event.all_day_start
          ? ""
          : formatInTimeZone(
              g.event.start_at!,
              "America/Vancouver",
              "h:mm",
            )}{" "}
        {g.event.title || "Untitled event"}
      </span>
      {!short && g.sources.length > 1 && <small>+{g.sources.length - 1}</small>}
    </button>
  );
  const dayRows = (day: string) =>
    on(day).map((g) => (
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
            : formatInTimeZone(
                g.event.start_at!,
                "America/Vancouver",
                "h:mm a",
              )}
        </time>
        <span className="agenda-row-content">
          <strong>{g.event.title || "Untitled event"}</strong>
          <small>
            {eventTimeLabel(g.event)} ·{" "}
            {g.sources.map((s) => name(s.calendar_id)).join(", ")}
          </small>
        </span>
        <span
          className="calendar-source-dot"
          style={{ background: color(g) }}
        />
      </button>
    ));
  return (
    <div className="planner-calendar">
      <div className="calendar-status-bar">
        <div className="calendar-status-text">
          <span className={`status-dot ${last ? "ready" : ""}`} />
          <span>
            {data
              ? calendars.length
                ? `${calendars.length} calendars · ${last ? "Updated " + formatInTimeZone(last, "America/Vancouver", "h:mm a") : "Sync needed"}`
                : "No calendars selected"
              : "Loading calendars…"}
          </span>
        </div>
        <div className="inline">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilters(!filters)}
            aria-expanded={filters}
          >
            <SlidersHorizontal size={14} />
            Calendars
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh calendar events"
            disabled={!!busy || !calendars.length}
            onClick={() => void sync()}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
          </Button>
        </div>
      </div>
      {filters && (
        <div className="calendar-filter-panel">
          <div className="calendar-filter-chips">
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
                <span
                  className="calendar-source-dot"
                  style={{ background: c.color ?? "#407BEE" }}
                />
                {c.name}
              </button>
            ))}
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={group}
              onChange={(e) => setGroup(e.currentTarget.checked)}
            />
            Group matching entries across calendars
          </label>
          <Link className="text-link" href="/settings?section=integrations">
            Manage connections
          </Link>
        </div>
      )}
      {error && (
        <p className="calendar-inline-alert error-message" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="calendar-inline-alert" role="status">
          {message}
        </p>
      )}
      {coverageMissing && (
        <p className="calendar-inline-alert muted">
          Some dates are outside the synced range. Missing events do not mean
          free time.
        </p>
      )}
      {!calendars.length && data && (
        <p className="calendar-inline-alert muted">
          Select calendars in{" "}
          <Link className="text-link" href="/settings?section=integrations">
            Settings
          </Link>{" "}
          to see your schedule.
        </p>
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
            const deadlines = due(key);
            return (
              <div
                key={key}
                className={`month-cell ${d.getMonth() !== anchor.getMonth() ? "outside" : ""} ${key === localDate() ? "is-today" : ""}`}
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
                </button>
                {list.slice(0, 2).map((g) => eventButton(g, true))}
                {deadlines.slice(0, 1).map((t) => (
                  <button
                    className="deadline-chip"
                    key={t.id}
                    onClick={() => onTask(t)}
                  >
                    Due · {t.title}
                  </button>
                ))}
                {(list.length > 2 || deadlines.length > 1) && (
                  <button
                    className="calendar-more"
                    onClick={() => setDayDetail(key)}
                  >
                    +
                    {list.length +
                      deadlines.length -
                      Math.min(list.length, 2) -
                      Math.min(deadlines.length, 1)}{" "}
                    more
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
              {on(selectedDay).length} entries
            </span>
          </div>
          {dayRows(selectedDay)}
          {due(selectedDay).map((t) => (
            <button
              className="agenda-compact-row"
              key={t.id}
              onClick={() => onTask(t)}
            >
              <time>Deadline</time>
              <strong>{t.title}</strong>
            </button>
          ))}
          {!on(selectedDay).length && !due(selectedDay).length && (
            <p className="calendar-empty">
              <CalendarDays size={24} />
              No cached commitments for this day.
            </p>
          )}
        </div>
      ) : (
        <>
          {view === "week" && (
            <div className="mobile-week-picker">
              {days.map((d) => (
                <button
                  className={
                    format(d, "yyyy-MM-dd") === selectedDay ? "active" : ""
                  }
                  key={d.toISOString()}
                  onClick={() => onDay(d)}
                  aria-pressed={format(d, "yyyy-MM-dd") === selectedDay}
                >
                  <span>{format(d, "EEEEE")}</span>
                  <strong>{format(d, "d")}</strong>
                </button>
              ))}
            </div>
          )}
          <div
            className="time-calendar"
            style={{ "--days": days.length } as React.CSSProperties}
          >
            <div className="time-grid-header">
              <div className="time-axis-label">
                {formatInTimeZone(anchor, "America/Vancouver", "O")}
              </div>
              {days.map((d) => (
                <button
                  key={d.toISOString()}
                  className={`time-day-heading ${format(d, "yyyy-MM-dd") === selectedDay ? "selected-mobile" : ""} ${format(d, "yyyy-MM-dd") === localDate() ? "is-today" : ""}`}
                  onClick={() => onDay(d)}
                >
                  <span>{format(d, "EEE")}</span>
                  <strong>{format(d, "d")}</strong>
                </button>
              ))}
            </div>
            <div className="all-day-grid">
              <span className="time-axis-label">
                All day
                <br />/ Due
              </span>
              {days.map((d) => {
                const key = format(d, "yyyy-MM-dd");
                const all = on(key).filter((g) => g.event.all_day_start);
                const deadlines = due(key);
                return (
                  <div
                    key={key}
                    className={key === selectedDay ? "selected-mobile" : ""}
                  >
                    {all.slice(0, 2).map((g) => eventButton(g, true))}
                    {deadlines.slice(0, 1).map((t) => (
                      <button
                        className="deadline-chip"
                        key={t.id}
                        onClick={() => onTask(t)}
                      >
                        Due · {t.title}
                      </button>
                    ))}
                    {all.length > 2 || deadlines.length > 1 ? (
                      <button
                        className="calendar-more"
                        onClick={() => setDayDetail(key)}
                      >
                        View all
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
                    <span key={h} style={{ top: h * 36 }}>
                      {h === 0
                        ? "12 AM"
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
                  return (
                    <div
                      key={day}
                      className={`time-day-column ${day === selectedDay ? "selected-mobile" : ""} ${day === localDate() ? "is-today" : ""}`}
                    >
                      {layoutDay(groups, day).map((g) => (
                        <button
                          key={g.id}
                          className="time-event"
                          onClick={() => {
                            setDayDetail(null);
                            setDetails(g);
                          }}
                          title={`${g.event.title} · ${eventTimeLabel(g.event)}`}
                          style={{
                            top: g.start * 0.6,
                            height: Math.max(20, (g.end - g.start) * 0.6 - 2),
                            left: `calc(${(g.column / g.columns) * 100}% + 2px)`,
                            width: `calc(${100 / g.columns}% - 4px)`,
                            borderLeftColor: color(g),
                            background: `color-mix(in srgb, ${color(g)} 17%, var(--surface))`,
                          }}
                        >
                          <strong>{g.event.title || "Untitled event"}</strong>
                          <small>
                            {formatInTimeZone(
                              g.event.start_at!,
                              "America/Vancouver",
                              "h:mm a",
                            )}
                            {g.sources.length > 1
                              ? ` · ${g.sources.length} calendars`
                              : ""}
                          </small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      <div className="calendar-footnote">
        <span>Google events are read-only · Deadlines don’t reserve time</span>
        <Link href="/settings?section=integrations">Sync settings</Link>
      </div>
      {details && (
        <Modal
          title={details.event.title || "Calendar event"}
          open
          onOpenChange={(open) => {
            if (!open) setDetails(null);
          }}
          description="Original Google event details. Calendar writes are disabled."
        >
          <div className="event-detail">
            <span className="badge">Read-only Google event</span>
            <p>
              {details.event.all_day_start ??
                formatInTimeZone(
                  details.event.start_at!,
                  "America/Vancouver",
                  "EEEE, MMMM d, yyyy",
                )}
            </p>
            <strong>{eventTimeLabel(details.event)}</strong>
            {details.sources.length > 1 && (
              <p className="muted small">
                {details.sources.length} matching source entries are grouped for
                display. Original records are preserved.
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
          description="Calendar entries and task deadlines for this day."
        >
          <div className="day-detail-list">
            {dayRows(dayDetail)}
            {due(dayDetail).map((t) => (
              <button
                className="agenda-compact-row"
                key={t.id}
                onClick={() => {
                  setDayDetail(null);
                  onTask(t);
                }}
              >
                <time>Deadline</time>
                <strong>{t.title}</strong>
              </button>
            ))}
            {!on(dayDetail).length && !due(dayDetail).length && (
              <p className="muted">No entries for this day.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
