"use client";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { addDays } from "date-fns";
import { Trophy, Dumbbell, Users, Target, CalendarDays } from "lucide-react";
import { useCalendar } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { useCurrentTime } from "./use-current-time";
import { useFollowUps } from "./career-follow-ups";
import {
  GAME_AFTER_MIN,
  GAME_BEFORE_MIN,
  isTeamEvent,
  teamEventKind,
  type TeamEventKind,
} from "@/lib/basketball";
import { dueLabel } from "@/lib/display";

const ZONE = "America/Vancouver";
const day = (ms: number) => formatInTimeZone(ms, ZONE, "yyyy-MM-dd");
const time = (ms: number) => formatInTimeZone(ms, ZONE, "h:mm a");
const label: Record<TeamEventKind, string> = {
  game: "Game",
  practice: "Practice",
  weights: "Weights",
  shoot: "Shootaround",
  other: "Team",
};
const icon = (k: TeamEventKind) =>
  k === "game"
    ? Trophy
    : k === "weights"
      ? Dumbbell
      : k === "other"
        ? CalendarDays
        : Users;

/**
 * The manager's week: games and practices from the team calendar, game-day
 * timing, basketball tasks and the people in the program.
 */
export function BasketballPage() {
  const now = useCurrentTime();
  const start = formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  const end = formatInTimeZone(addDays(now, 14), ZONE, "yyyy-MM-dd");
  const { data: calendar, events, error } = useCalendar(start, end);
  const { data } = useWorkspace();
  const { state: people } = useFollowUps();
  const calendarName = (id: string) =>
    calendar?.calendars.find((c) => c.id === id)?.name ?? "";
  const team = events
    .filter((e) => e.start_at && e.end_at && !e.all_day_start)
    .filter((e) => isTeamEvent(e.title, calendarName(e.calendar_id)))
    .map((e) => ({
      id: e.id,
      title: e.title.replace(/^MBB\s*·\s*/i, ""),
      start: Date.parse(e.start_at!),
      end: Date.parse(e.end_at!),
      kind: teamEventKind(e.title),
    }))
    .filter((e) => e.end > now.getTime())
    .sort((a, b) => a.start - b.start)
    .filter(
      (e, i, all) =>
        !all
          .slice(0, i)
          .some((o) => o.title === e.title && o.start === e.start),
    );
  const nextGame = team.find((e) => e.kind === "game");
  const week = team.filter((e) => e.start < addDays(now, 7).getTime());
  const days = [...new Set(week.map((e) => day(e.start)))];
  const area = data.areas.find((a) => /basketball/i.test(a.name));
  const tasks = data.tasks
    .filter(
      (t) =>
        !t.deleted_at &&
        !["completed", "cancelled"].includes(t.status) &&
        ((area && t.area_id === area.id) ||
          /\bmbb\b|basketball|scout|film|stat sheet|shooting chart/i.test(
            t.title,
          )),
    )
    .slice(0, 8);
  const crew = (people?.follow_ups ?? []).filter((f) =>
    /basketball|mbb|hoops|bandits/i.test(f.organization),
  );
  const games = week.filter((e) => e.kind === "game").length;
  const practices = week.filter((e) => e.kind === "practice").length;

  return (
    <div className="td">
      <header className="td-header">
        <p className="td-eyebrow">SFU MEN’S BASKETBALL</p>
        <h1>Basketball</h1>
        <p className="td-summary">
          {nextGame
            ? `Next game: ${nextGame.title} · ${dueLabel(new Date(nextGame.start).toISOString())}`
            : "No games in the next two weeks"}
          {week.length
            ? ` · this week ${games} game${games === 1 ? "" : "s"}, ${practices} practice${practices === 1 ? "" : "s"}`
            : ""}
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="td-grid">
        <section className="td-card" aria-label="This week">
          <div className="td-card-head">
            <h2 className="td-card-title">This week</h2>
            <Link href="/planner" className="td-link">
              Week
            </Link>
          </div>
          {!week.length && (
            <p className="course-empty">
              Nothing on the team calendar for the next seven days.
            </p>
          )}
          {days.map((d) => (
            <div key={d} className="bb-day">
              <h3>
                {formatInTimeZone(
                  new Date(d + "T12:00:00Z"),
                  "UTC",
                  "EEEE, MMM d",
                )}
              </h3>
              <ul>
                {week
                  .filter((e) => day(e.start) === d)
                  .map((e) => {
                    const Icon = icon(e.kind);
                    return (
                      <li key={e.id} className={`bb-event bb-${e.kind}`}>
                        <span className="bb-icon" aria-hidden>
                          <Icon size={16} />
                        </span>
                        <span className="bb-what">
                          <strong>{e.title}</strong>
                          <span>
                            {label[e.kind]} · {time(e.start)}–{time(e.end)}
                          </span>
                          {e.kind === "game" && (
                            <span className="bb-protect">
                              Kept clear{" "}
                              {time(e.start - GAME_BEFORE_MIN * 60000)}–
                              {time(e.end + GAME_AFTER_MIN * 60000)} for setup
                              and wrap-up
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </section>
        <div className="td-col">
          <section className="td-card" aria-label="Manager tasks">
            <div className="td-card-head">
              <h2 className="td-card-title">Manager tasks</h2>
              <Link href="/planner?section=tasks" className="td-link">
                All tasks
              </Link>
            </div>
            {!tasks.length && (
              <p className="course-empty">No open basketball tasks.</p>
            )}
            <ul className="topic-list">
              {tasks.map((t) => (
                <li key={t.id} className="person">
                  <div>
                    <strong>{t.title}</strong>
                    {t.due_at || t.due_date ? (
                      <span>
                        {dueLabel({ due_at: t.due_at, due_date: t.due_date })}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          {crew.length > 0 && (
            <section className="td-card" aria-label="Program people">
              <div className="td-card-head">
                <h2 className="td-card-title">Program people</h2>
                <Link href="/growth" className="td-link">
                  <Target size={14} aria-hidden /> Follow-ups
                </Link>
              </div>
              <ul className="topic-list">
                {crew.map((f) => (
                  <li key={f.row_id} className="person">
                    <div>
                      <strong>{f.name}</strong>
                      <span>{f.role}</span>
                    </div>
                    <span className={`person-since ${f.due ? "due" : ""}`}>
                      {f.days_since === null
                        ? "No conversation logged"
                        : `${f.days_since}d since last talk`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
