"use client";
/**
 * Shapes for information that used to sit in grey cards: people orbit you,
 * past weeks are postcards, goals are trails.
 */
import Link from "next/link";
import { Avatar } from "./living";

/* ── 06 · People in orbit ─────────────────────────────────────────────── */
export type OrbitPerson = {
  id: string;
  name: string;
  photo?: string | null;
  due: boolean;
  /** Days since the last logged conversation; null when none. */
  daysSince: number | null;
  href?: string;
};
/** Inner ring: talked within two weeks; middle: within a month; outer: longer or never. */
export function ringOf(days: number | null) {
  return days === null || days > 30 ? 2 : days > 14 ? 1 : 0;
}
export function PeopleOrbit({ people }: { people: OrbitPerson[] }) {
  // Ring radii as a share of the height; the box is 1.2 wide per 1 tall.
  const rings = [0.17, 0.29, 0.4];
  const xf = 100 / 1.2;
  const byRing = [0, 1, 2].map((r) =>
    people.filter((p) => ringOf(p.daysSince) === r),
  );
  return (
    <div
      className="orbit"
      role="list"
      aria-label="People, closer when you talked recently"
    >
      {rings.map((r) => (
        <span
          key={r}
          className="orbit-ring"
          style={{ width: `${r * 2 * xf}%`, height: `${r * 2 * 100}%` }}
          aria-hidden
        />
      ))}
      <span className="orbit-you" aria-hidden>
        You
      </span>
      {byRing.flatMap((group, r) =>
        group.map((p, i) => {
          const angle = (i / group.length) * 2 * Math.PI + r * 0.9 + 0.4;
          const x = 50 + Math.cos(angle) * rings[r] * xf;
          const y = 50 + Math.sin(angle) * rings[r] * 100;
          const first = p.name
            .replace(/\[.*?\]/g, "")
            .trim()
            .split(/\s+/)[0];
          return (
            <Link
              key={p.id}
              role="listitem"
              href={p.href ?? "/areas/career"}
              className={`orbit-person ${p.due ? "due" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              aria-label={`${p.name}${p.due ? ", due for a check-in" : ""}${
                p.daysSince === null
                  ? ", no conversation logged"
                  : `, ${p.daysSince} days since you talked`
              }`}
            >
              <Avatar name={p.name} photo={p.photo} due={p.due} size={44} />
              <span aria-hidden>
                {first}
                {p.due ? " · due" : ""}
              </span>
            </Link>
          );
        }),
      )}
    </div>
  );
}

/* ── 09 · Past weeks as postcards ─────────────────────────────────────── */
export type Postcard = {
  id: string;
  week: string;
  title: string;
  risk?: string;
  verdict?: string;
  onOpen?: () => void;
};
const VERDICT_AREA: Record<string, string> = {
  "on track": "career",
  steady: "school",
  reviewed: "school",
  mixed: "study",
  "off track": "ball",
  "at risk": "ball",
};
export function Postcards({ cards }: { cards: Postcard[] }) {
  if (!cards.length) return null;
  return (
    <ul className="postcards" aria-label="Past weeks">
      {cards.map((c, i) => {
        const v = (c.verdict ?? "").toLowerCase();
        const area =
          Object.entries(VERDICT_AREA).find(([k]) => v.startsWith(k))?.[1] ??
          "other";
        return (
          <li
            key={c.id}
            className={`postcard area-${area}`}
            style={{ rotate: `${[-1.2, 0.8, -0.6, 1.1][i % 4]}deg` }}
          >
            <button type="button" onClick={c.onOpen} className="postcard-body">
              <span className="postcard-week">{c.week}</span>
              <strong>{c.title}</strong>
              {c.risk && <span className="postcard-risk">Risk: {c.risk}</span>}
              {c.verdict && <span className="postcard-stamp">{c.verdict}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── 11 · Goals as a trail map ────────────────────────────────────────── */
export type TrailStop = { title: string; done: boolean; date?: string | null };
/** Stops along a wave from left to right; the first open stop is "you are here". */
export function TrailMap({
  stops,
  finish,
}: {
  stops: TrailStop[];
  /** The goal itself, drawn as the last stop. */
  finish: string;
}) {
  const all = [...stops, { title: finish, done: false, date: null }];
  const n = all.length;
  const W = 640;
  const H = 150;
  const point = (i: number) => {
    const x = 24 + ((W - 48) * i) / Math.max(1, n - 1);
    const y = 82 + Math.sin(i * 1.3 + 0.4) * 44;
    return { x, y };
  };
  const here = all.findIndex((s) => !s.done);
  const path = (upto: number) =>
    all
      .slice(0, upto + 1)
      .map((_, i) => {
        const p = point(i);
        if (i === 0) return `M${p.x} ${p.y}`;
        const q = point(i - 1);
        const mx = (q.x + p.x) / 2;
        return `C ${mx} ${q.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
      })
      .join(" ");
  const done = all.filter((s) => s.done).length;
  return (
    <svg
      className="trail"
      viewBox={`0 0 ${W} ${H + 30}`}
      role="img"
      aria-label={`${finish}: ${done} of ${stops.length} steps done`}
    >
      <path d={path(n - 1)} className="trail-path" />
      {here > 0 && <path d={path(here)} className="trail-done" />}
      {all.map((s, i) => {
        const p = point(i);
        const isHere = i === here;
        const last = i === n - 1;
        const label =
          s.title.length > 26 ? s.title.slice(0, 25) + "…" : s.title;
        const below = p.y < 82;
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={isHere || last ? 11 : 8}
              className={
                s.done
                  ? "trail-stop done"
                  : isHere
                    ? "trail-stop here"
                    : "trail-stop"
              }
            />
            <text
              x={p.x}
              y={below ? p.y + 28 : p.y - 18}
              textAnchor={i === 0 ? "start" : last ? "end" : "middle"}
              className={
                isHere
                  ? "trail-label here"
                  : last
                    ? "trail-label finish"
                    : "trail-label"
              }
            >
              {isHere && !last ? "You are here · " : ""}
              {label}
              {s.done ? " ✓" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
