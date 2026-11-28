"use client";
import { useEffect, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { calendarRequest } from "./use-calendar";
import { TrackHandle } from "./settings-visuals";
import { areaOf } from "@/lib/areas";
import { freeWindows, minutesLabel } from "@/lib/calendar-style";
import type { Policy } from "@/lib/scheduler";
import type { CalendarEvent } from "@/lib/integrations/calendar-view";

const ZONE = "America/Vancouver";
const hour = (h: number) =>
  `${h % 12 || 12} ${h < 12 || h === 24 ? "AM" : "PM"}`;

type Block = { start: number; end: number; title: string; area: string };

/**
 * P1: today as a 24-hour ribbon. Your planning hours sit between two
 * handles; what's already on the calendar is drawn on top, so the room
 * left to plan is visible.
 */
export function DayRibbon({
  policy,
  onChange,
}: {
  policy: Policy;
  onChange: (p: Policy) => void;
}) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  useEffect(() => {
    let live = true;
    const today = formatInTimeZone(new Date(), ZONE, "yyyy-MM-dd");
    const start = fromZonedTime(today + "T00:00:00", ZONE).getTime();
    const tomorrow = formatInTimeZone(start + 36 * 3600000, ZONE, "yyyy-MM-dd");
    void calendarRequest<{ events: CalendarEvent[] }>(
      `/api/v1/calendar/events?start=${today}&end=${tomorrow}`,
    )
      .then((r) => {
        if (!live) return;
        setBlocks(
          r.events
            .filter((e) => e.start_at && e.end_at && e.busy_status !== "free")
            .map((e) => ({
              start: Math.max(0, (Date.parse(e.start_at!) - start) / 60000),
              end: Math.min(1440, (Date.parse(e.end_at!) - start) / 60000),
              title: e.title,
              area: areaOf(e.title),
            }))
            .filter((b) => b.end > b.start),
        );
      })
      .catch(() => live && setBlocks([]));
    return () => {
      live = false;
    };
  }, []);
  const free = blocks
    ? freeWindows(
        blocks,
        policy.start_hour,
        policy.end_hour,
        null,
        policy.min_session_minutes,
      ).reduce((n, w) => n + (w.end - w.start), 0)
    : null;
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  return (
    <div className="st-ribbon-wrap">
      <div className="st-ribbon" aria-label="Today, midnight to midnight">
        <div
          className="st-work"
          style={{
            left: pct(policy.start_hour * 60),
            width: pct((policy.end_hour - policy.start_hour) * 60),
          }}
        />
        {(blocks ?? []).map((b, i) => (
          <div
            key={i}
            className={`st-block area-${b.area}`}
            style={{ left: pct(b.start), width: pct(b.end - b.start) }}
            title={b.title}
          >
            <span>{b.title}</span>
          </div>
        ))}
        <TrackHandle
          label="Planning starts"
          value={policy.start_hour}
          min={9}
          max={Math.min(20, policy.end_hour - 1)}
          track={[0, 24]}
          text={hour(policy.start_hour)}
          onChange={(v) => onChange({ ...policy, start_hour: v })}
        />
        <TrackHandle
          label="Planning ends"
          value={policy.end_hour}
          min={Math.max(10, policy.start_hour + 1)}
          max={21}
          track={[0, 24]}
          text={hour(policy.end_hour)}
          onChange={(v) => onChange({ ...policy, end_hour: v })}
        />
      </div>
      <div className="st-ticks mono" aria-hidden>
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>12a</span>
      </div>
      <p className="st-ribbon-note">
        <span>
          Planning hours{" "}
          <b>
            {hour(policy.start_hour)}–{hour(policy.end_hour)}
          </b>
        </span>
        <span>
          {free === null ? (
            "Reading today's calendar…"
          ) : (
            <>
              Free to plan today <b>{minutesLabel(free)}</b>
            </>
          )}
        </span>
      </p>
    </div>
  );
}

/**
 * P2: session lengths drawn to scale, so the numbers look like what the
 * planner will book. Drag a block's edge to change it.
 */
export function SessionBlocks({
  policy,
  onChange,
}: {
  policy: Policy;
  onChange: (p: Policy) => void;
}) {
  const scale = 160; // minutes across a session row
  const pct = (m: number, of = scale) => `${(m / of) * 100}%`;
  const capSessions: number[] = [];
  for (let used = 0; used < policy.max_daily_minutes;) {
    const len = Math.min(
      policy.max_session_minutes,
      policy.max_daily_minutes - used,
    );
    capSessions.push(len);
    used += len;
  }
  return (
    <div className="st-sessions">
      <div className="st-srow">
        <span>Shortest session</span>
        <div className="st-strack">
          <i
            className="st-sblock"
            style={{ width: pct(policy.min_session_minutes) }}
          >
            {policy.min_session_minutes}m
          </i>
          <TrackHandle
            label="Shortest session"
            value={policy.min_session_minutes}
            min={25}
            max={90}
            step={5}
            track={[0, scale]}
            text={`${policy.min_session_minutes} minutes`}
            onChange={(v) =>
              onChange({
                ...policy,
                min_session_minutes: v,
                max_session_minutes: Math.max(v, policy.max_session_minutes),
                max_daily_minutes: Math.max(v, policy.max_daily_minutes),
              })
            }
          />
        </div>
      </div>
      <div className="st-srow">
        <span>Longest session</span>
        <div className="st-strack">
          <i
            className="st-sblock"
            style={{ width: pct(policy.max_session_minutes) }}
          >
            {policy.max_session_minutes}m
          </i>
          <i
            className="st-sgap"
            style={{
              left: pct(policy.max_session_minutes),
              width: pct(policy.break_minutes),
            }}
          >
            {policy.break_minutes}m break
          </i>
          <TrackHandle
            label="Longest session"
            value={policy.max_session_minutes}
            min={25}
            max={90}
            step={5}
            track={[0, scale]}
            text={`${policy.max_session_minutes} minutes`}
            onChange={(v) =>
              onChange({
                ...policy,
                max_session_minutes: v,
                min_session_minutes: Math.min(v, policy.min_session_minutes),
              })
            }
          />
        </div>
      </div>
      <div className="st-srow">
        <span>Break between</span>
        <div className="st-strack">
          <i
            className="st-sgap st-sgap-solo"
            style={{ width: pct(policy.break_minutes) }}
          >
            {policy.break_minutes}m
          </i>
          <TrackHandle
            label="Break between sessions"
            value={policy.break_minutes}
            min={10}
            max={60}
            step={5}
            track={[0, scale]}
            text={`${policy.break_minutes} minutes`}
            onChange={(v) => onChange({ ...policy, break_minutes: v })}
          />
        </div>
      </div>
      <div className="st-srow st-srow-cap">
        <span>Most per day</span>
        <div className="st-strack">
          {capSessions.map((len, i) => (
            <i
              key={i}
              className="st-sblock st-scap"
              style={{
                left: pct(
                  capSessions.slice(0, i).reduce((n, l) => n + l, 0),
                  240,
                ),
                width: pct(len, 240),
              }}
            />
          ))}
          <TrackHandle
            label="Most planned work per day"
            value={policy.max_daily_minutes}
            min={Math.max(25, policy.min_session_minutes)}
            max={240}
            step={5}
            track={[0, 240]}
            className="st-handle-cap"
            text={minutesLabel(policy.max_daily_minutes)}
            onChange={(v) => onChange({ ...policy, max_daily_minutes: v })}
          />
        </div>
        <b className="st-cap-label">{minutesLabel(policy.max_daily_minutes)}</b>
      </div>
    </div>
  );
}
