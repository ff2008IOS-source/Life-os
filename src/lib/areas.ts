/**
 * Every item belongs to an area, and each area has its own colour across
 * Life OS: School blue, Career green, Basketball red, Study violet, Gym
 * teal. The calendar uses the same colours, so a colour always means the
 * same thing.
 */
import { formatInTimeZone } from "date-fns-tz";
import { eventStyle, type Tone } from "./calendar-style";

export type Area = "school" | "career" | "ball" | "study" | "gym" | "other";

const FROM_TONE: Record<Tone, Area> = {
  class: "school",
  mbb: "ball",
  study: "study",
  gym: "gym",
  career: "career",
  other: "other",
};
const COURSE_START = /^[A-Z]{2,5}\s?\d{3}[A-Z]?\b/;

/** The area of an event or a piece of work, from its title (and label). */
export function areaOf(title: string, label = "", calendar = ""): Area {
  const t = title.trim();
  if (/^(follow up with|apply:)/i.test(t)) return "career";
  if (/\b(basketball|mbb|shooting|scout)/i.test(t)) return "ball";
  if (COURSE_START.test(t) || COURSE_START.test(label.trim())) return "school";
  const tone = FROM_TONE[eventStyle(t, calendar).tone];
  return tone;
}

export type SkylineDay = {
  date: string;
  /** Minutes of timed, busy events. */
  busyMinutes: number;
  events: number;
  /** Short labels for deadlines that day. */
  pins: string[];
};

/** One bar per day of the week starting `weekStart` (a local date). */
export function weekSkyline(
  events: {
    start_at: string | null;
    end_at: string | null;
    busy_status?: string | null;
  }[],
  deadlines: { title: string; label: string; due: number }[],
  weekStart: string,
  zone: string,
): SkylineDay[] {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const byDay = new Map(
    days.map((date) => [
      date,
      { date, busyMinutes: 0, events: 0, pins: [] as string[] },
    ]),
  );
  for (const e of events) {
    if (!e.start_at || !e.end_at || e.busy_status === "free") continue;
    const day = byDay.get(
      formatInTimeZone(Date.parse(e.start_at), zone, "yyyy-MM-dd"),
    );
    if (!day) continue;
    day.events++;
    day.busyMinutes += Math.max(
      0,
      Math.min(
        16 * 60,
        (Date.parse(e.end_at) - Date.parse(e.start_at)) / 60000,
      ),
    );
  }
  for (const d of deadlines) {
    const day = byDay.get(formatInTimeZone(d.due, zone, "yyyy-MM-dd"));
    if (!day) continue;
    const code =
      d.label.match(COURSE_START)?.[0] ?? d.title.match(COURSE_START)?.[0];
    day.pins.push(
      code ? `${code}` : d.title.split(/\s[—·-]\s/)[0].slice(0, 14),
    );
  }
  return [...byDay.values()];
}
