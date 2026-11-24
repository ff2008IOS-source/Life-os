/**
 * Basketball-manager helpers. Events come from the team calendar ("SFU Men's
 * Basketball") or carry the "MBB" prefix the owner uses for team events.
 */
export type TeamEventKind = "game" | "practice" | "weights" | "shoot" | "other";

const norm = (s: string) => s.toLowerCase();

export function isTeamEvent(title: string, calendar = "") {
  return (
    /\bmbb\b|basketball/i.test(title) || /basketball|\bmbb\b/i.test(calendar)
  );
}

export function teamEventKind(title: string): TeamEventKind {
  const t = norm(title);
  if (/\bgame\b|\bvs\.?\s|\s@\s|tip[- ]?off/.test(t)) return "game";
  if (/practice/.test(t)) return "practice";
  if (/weights|lift|strength/.test(t)) return "weights";
  if (/shoot/.test(t)) return "shoot";
  return "other";
}

/** Time kept clear around a game: setup before tip-off, wrap-up after. */
export const GAME_BEFORE_MIN = 90;
export const GAME_AFTER_MIN = 30;

export function isGame(title: string, calendar = "") {
  return isTeamEvent(title, calendar) && teamEventKind(title) === "game";
}
