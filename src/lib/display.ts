import { formatInTimeZone } from "date-fns-tz";

/** Life OS always shows times in Vancouver, whatever the device clock says. */
export const DISPLAY_ZONE = "America/Vancouver";

function dayKey(ms: number | Date, zone: string) {
  return formatInTimeZone(ms, zone, "yyyy-MM-dd");
}
function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000,
  );
}

/**
 * "Today", "Tomorrow", "Yesterday", a weekday within the next six days
 * ("Thursday"), otherwise a date ("Mon, Dec 7"). Dates in another year add it.
 */
export function dayLabel(
  value: number | string | Date,
  now: Date = new Date(),
  zone = DISPLAY_ZONE,
) {
  const ms =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.parse(value + "T12:00:00Z")
      : new Date(value).getTime();
  const day =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : dayKey(ms, zone);
  const diff = daysBetween(dayKey(now, zone), day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const z = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? "UTC" : zone;
  if (diff > 1 && diff < 7) return formatInTimeZone(ms, z, "EEEE");
  const sameYear = day.slice(0, 4) === dayKey(now, zone).slice(0, 4);
  return formatInTimeZone(ms, z, sameYear ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

/** "Tomorrow, 4:20 PM" or just "Tomorrow" for date-only deadlines. */
export function dueLabel(
  due: { due_at?: string | null; due_date?: string | null } | string,
  now: Date = new Date(),
  zone = DISPLAY_ZONE,
) {
  const at = typeof due === "string" ? due : due.due_at;
  const date = typeof due === "string" ? null : due.due_date;
  if (at)
    return `${dayLabel(at, now, zone)}, ${formatInTimeZone(at, zone, "h:mm a")}`;
  if (date) return dayLabel(date, now, zone);
  return "No due date";
}

/** Short badge text: "TODAY", "TMRW", "WED", "DEC 7". */
export function dayBadge(
  value: number | string | Date,
  now: Date = new Date(),
  zone = DISPLAY_ZONE,
) {
  const label = dayLabel(value, now, zone);
  if (label === "Today") return "TODAY";
  if (label === "Tomorrow") return "TMRW";
  if (label === "Yesterday") return "YDAY";
  if (!label.includes(",")) return label.slice(0, 3).toUpperCase();
  return formatInTimeZone(
    new Date(value).getTime(),
    zone,
    "MMM d",
  ).toUpperCase();
}

export type MarkTone = "good" | "ok" | "low";
/** 83% and above is green, 70–83% orange, below 70% red. */
export function markTone(percent: number): MarkTone {
  return percent >= 83 ? "good" : percent >= 70 ? "ok" : "low";
}
/** Percentage from a score, or null when there is nothing to grade. */
export function markPercent(
  earned: number | null | undefined,
  maximum: number | null | undefined,
  unit: "points" | "percent" = "points",
) {
  if (typeof earned !== "number") return null;
  if (unit === "percent") return earned;
  if (typeof maximum !== "number" || maximum <= 0) return null;
  return (earned / maximum) * 100;
}
export function formatPercent(p: number) {
  return `${Math.round(p * 10) / 10}%`;
}

/** A timestamp in Vancouver time: "Nov 21, 6:50 AM" (adds the year if not this year). */
export function stamp(value: string | number | Date, now: Date = new Date()) {
  const ms = new Date(value).getTime();
  const sameYear =
    formatInTimeZone(ms, DISPLAY_ZONE, "yyyy") ===
    formatInTimeZone(now, DISPLAY_ZONE, "yyyy");
  return formatInTimeZone(
    ms,
    DISPLAY_ZONE,
    sameYear ? "MMM d, h:mm a" : "MMM d, yyyy, h:mm a",
  );
}
