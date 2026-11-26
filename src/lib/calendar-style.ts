/**
 * How the calendar reads at a glance. Event titles follow "Category ·
 * Detail" ("Gym · A", "MBB · Game vs APU", "ECON 113 · Lecture"); the
 * category picks the colour, so the block can say only what's new.
 */
export type Tone = "class" | "mbb" | "gym" | "study" | "career" | "other";

export const TONES: { tone: Tone; label: string }[] = [
  { tone: "class", label: "Class" },
  { tone: "mbb", label: "Basketball" },
  { tone: "study", label: "Study" },
  { tone: "gym", label: "Gym" },
  { tone: "career", label: "Career" },
  { tone: "other", label: "Other" },
];

const COURSE = /^[A-Z]{2,5}\s?\d{3}[A-Z]?$/;

function toneOf(category: string, calendar: string): Tone {
  const c = `${category} ${calendar}`.toLowerCase();
  if (COURSE.test(category.trim())) return "class";
  if (/\b(mbb|basketball|athletics)\b/.test(c)) return "mbb";
  if (/\b(gym|weights|lift|workout|run)\b/.test(c)) return "gym";
  if (/\b(study|deep work|review)\b/.test(c)) return "study";
  if (/\b(career|network|interview|application)\b/.test(c)) return "career";
  if (/\bsfu\b/.test(calendar.toLowerCase())) return "class";
  return "other";
}

export function eventStyle(title: string, calendar = "") {
  const raw = (title || "Untitled event").trim();
  const m = raw.match(/^(.{1,40}?)\s+[·•|–-]\s+(.+)$/);
  if (!m) return { tone: toneOf(raw, calendar), label: raw };
  const [, category, detail] = m;
  const tone = toneOf(category, calendar);
  // "ECON 113 Lecture" keeps its code; "Gym · A" keeps "Gym" (A alone says
  // nothing); otherwise the colour already names the category.
  const label =
    tone === "class" && COURSE.test(category.trim())
      ? `${category} ${detail}`
      : detail.length <= 3
        ? `${category} ${detail}`
        : detail;
  return { tone, label };
}

export type Span = { start: number; end: number };

/**
 * Free stretches (≥ 30 minutes) inside the planning window, in minutes from
 * midnight. Today's free time starts from now.
 */
export function freeWindows(
  busy: Span[],
  startHour: number,
  endHour: number,
  nowMinute: number | null = null,
  min = 30,
): Span[] {
  let cursor = Math.max(startHour * 60, nowMinute ?? 0);
  const end = endHour * 60;
  const out: Span[] = [];
  for (const b of [...busy].sort((a, b) => a.start - b.start)) {
    if (b.end <= cursor) continue;
    if (b.start >= end) break;
    if (b.start - cursor >= min) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (end - cursor >= min) out.push({ start: cursor, end });
  return out;
}

export const minutesLabel = (m: number) => {
  const h = Math.floor(m / 60),
    r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};

/** "5 events · 3h free", or "Busy" when under an hour is left. */
export function dayLoad(events: number, freeMinutes: number, past: boolean) {
  if (past) return events ? `${events} event${events === 1 ? "" : "s"}` : "";
  if (freeMinutes < 60 && events) return "Busy";
  return `${events ? `${events} · ` : ""}${minutesLabel(freeMinutes)} free`;
}

/** The time protected around a game (matches Today's agenda). */
export const GAME_BEFORE = 90;
export const GAME_AFTER = 30;
