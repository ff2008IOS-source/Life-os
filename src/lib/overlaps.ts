import { formatInTimeZone } from "date-fns-tz";

/**
 * Overlaps the owner has said are fine. One rule everywhere (Today, Week,
 * the briefing and the weekly review):
 * - two weekly events overlapping is a standing arrangement, never a clash;
 * - a pair the owner marked "It's fine" stays hidden, on every device.
 * A pair is identified by both titles and their start times of day, so the
 * same overlap next time it happens is remembered too.
 */
export const OVERLAP_PREFIX = "overlap-ok:";

type Side = { title: string; start: number | string };

const part = (x: Side) =>
  `${(x.title || "untitled").trim().toLowerCase()}@${formatInTimeZone(
    new Date(x.start),
    "America/Vancouver",
    "HH:mm",
  )}`;

export function overlapKey(a: Side, b: Side) {
  return (OVERLAP_PREFIX + [part(a), part(b)].sort().join("~")).slice(0, 300);
}

/** Should this overlap be shown as a clash? */
export function isClash(
  a: Side & { recurring?: boolean },
  b: Side & { recurring?: boolean },
  accepted: ReadonlySet<string>,
) {
  if (a.recurring && b.recurring) return false;
  return !accepted.has(overlapKey(a, b));
}
