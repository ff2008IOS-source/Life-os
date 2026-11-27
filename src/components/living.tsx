"use client";
/**
 * Small pieces of motion that each say something true: how much of the day
 * is left, how much of a grade is decided, who is due for a follow-up.
 * Every one is still and fully readable with reduced motion (living.css).
 */
import { useEffect, useState, type CSSProperties } from "react";

/* ── Day arc: a sun crossing the planning window ─────────────────────── */
export function DayArc({
  fraction,
  label,
  detail,
}: {
  /** 0 at the window's start, 1 at its end. */
  fraction: number;
  label: string;
  detail?: string;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const path = "M12 66 A66 56 0 0 1 144 66";
  // A point on the same half-ellipse (centre 78,66; radii 66×56).
  const sun = {
    x: 78 - 66 * Math.cos(Math.PI * f),
    y: 66 - 56 * Math.sin(Math.PI * f),
  };
  return (
    <figure
      className="lv-arc"
      aria-label={`${label}${detail ? `, ${detail}` : ""}`}
    >
      <svg viewBox="0 0 156 78" aria-hidden>
        <path d={path} className="lv-arc-track" />
        <path
          d={path}
          className="lv-arc-done"
          pathLength={100}
          style={{ strokeDashoffset: 100 - f * 100 } as CSSProperties}
        />
        <circle className="lv-arc-sun" r="6" cx={sun.x} cy={sun.y} />
      </svg>
      <figcaption>
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </figcaption>
    </figure>
  );
}

/* ── Week rhythm: one dot per day with focus time ─────────────────────── */
export function RhythmDots({
  days,
  filled,
  today,
}: {
  /** Local dates (yyyy-MM-dd), Monday first. */
  days: string[];
  filled: string[];
  today: string;
}) {
  const on = new Set(filled);
  const names = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <ol
      className="lv-rhythm"
      aria-label={`Focus logged on ${days.filter((d) => on.has(d)).length} of ${days.length} days`}
    >
      {days.map((d, i) => (
        <li key={d}>
          <span aria-hidden>{names[i] ?? ""}</span>
          <i
            className={`${on.has(d) ? "lv-on" : ""} ${d === today ? "lv-today" : ""} ${d > today ? "lv-future" : ""}`}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        </li>
      ))}
    </ol>
  );
}

/* ── Swish: an empty state that celebrates once ───────────────────────── */
export function Swish({ children }: { children: React.ReactNode }) {
  return (
    <div className="lv-swish">
      <svg viewBox="0 0 120 70" aria-hidden>
        <rect x="74" y="6" width="38" height="26" rx="3" className="lv-line" />
        <rect
          x="86"
          y="16"
          width="14"
          height="9"
          rx="1.5"
          className="lv-line"
        />
        <path d="M80 36 h26 l-4 20 h-18 z" className="lv-net" />
        <line x1="78" y1="35" x2="108" y2="35" className="lv-rim" />
        <g className="lv-ball">
          <circle r="6" />
          <path d="M-6 0h12M0-6v12" />
        </g>
      </svg>
      <p>{children}</p>
    </div>
  );
}

/* ── Mail envelope: opens when something changed from mail ────────────── */
export function MailEnvelope({ open }: { open: boolean }) {
  return (
    <span className={`lv-env ${open ? "lv-env-open" : ""}`} aria-hidden>
      <svg viewBox="0 0 24 18">
        <rect
          x="1"
          y="1"
          width="22"
          height="16"
          rx="3"
          className="lv-env-back"
        />
        <rect
          x="5"
          y="5"
          width="14"
          height="9"
          rx="1.5"
          className="lv-env-letter"
        />
        <path d="M1.5 2 L12 10 L22.5 2" className="lv-env-flap" />
      </svg>
    </span>
  );
}

/* ── Loading shimmer ──────────────────────────────────────────────────── */
export function Shimmer({
  lines = 3,
  label = "Loading",
}: {
  lines?: number;
  label?: string;
}) {
  return (
    <div className="lv-shimmer" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <i key={i} style={{ width: `${[100, 72, 86, 64][i % 4]}%` }} />
      ))}
    </div>
  );
}

/* ── Grade ring: slices at syllabus weight ────────────────────────────── */
export type RingPart = {
  label: string;
  weight: number;
  /** Fraction earned (0–1); null when not scored yet. */
  score: number | null;
};
export function GradeRing({
  parts,
  value,
  caption,
  size = 112,
}: {
  parts: RingPart[];
  /** The course grade to print in the middle, or null when unknown. */
  value: React.ReactNode | null;
  caption?: string;
  size?: number;
}) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((n, p) => n + p.weight, 0) || 1;
  const gap = parts.length > 1 ? 2.5 : 0;
  const offsets = parts.map((_, i) =>
    parts.slice(0, i).reduce((n, q) => n + (c * q.weight) / total, 0),
  );
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const scored = parts.filter((p) => p.score !== null);
  const decided = Math.round(
    (scored.reduce((n, p) => n + p.weight, 0) / total) * 100,
  );
  return (
    <figure
      className="lv-ring"
      style={{ width: size }}
      aria-label={`${value === null ? "No grade yet. " : ""}${decided}% of the grade is scored.`}
    >
      <svg viewBox="0 0 112 112" aria-hidden>
        <g transform="rotate(-90 56 56)">
          {parts.map((p, i) => {
            const span = (c * p.weight) / total;
            const len = Math.max(0, span - gap);
            const offset = -offsets[i];
            const tone =
              p.score === null
                ? ""
                : p.score >= 0.8
                  ? "lv-good"
                  : p.score >= 0.65
                    ? "lv-ok"
                    : "lv-low";
            return (
              <g key={i}>
                <circle
                  cx="56"
                  cy="56"
                  r={r}
                  className={p.score === null ? "lv-open" : "lv-track"}
                  strokeDasharray={`${len} ${c}`}
                  strokeDashoffset={offset}
                >
                  <title>{`${p.label} · ${p.weight}%${p.score === null ? " · not scored" : ` · ${Math.round(p.score * 1000) / 10}%`}`}</title>
                </circle>
                {p.score !== null && (
                  <circle
                    cx="56"
                    cy="56"
                    r={r}
                    className={`lv-fill ${tone}`}
                    strokeDasharray={`${drawn ? len * p.score : 0} ${c}`}
                    strokeDashoffset={offset}
                    style={{ transitionDelay: `${i * 160}ms` }}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption>
        <strong>{value ?? "—"}</strong>
        <span>{caption ?? `${decided}% scored`}</span>
      </figcaption>
    </figure>
  );
}

/* ── Countdown ring: days until an assessment ─────────────────────────── */
export function CountdownRing({
  days,
  span = 14,
  size = 40,
}: {
  days: number;
  /** Days the ring covers when full. */
  span?: number;
  size?: number;
}) {
  const left = Math.max(0, Math.min(span, days));
  const tone = days <= 3 ? "lv-low" : days <= 7 ? "lv-ok" : "lv-calm";
  return (
    <span
      className={`lv-count ${tone}`}
      style={{ width: size, height: size }}
      aria-label={
        days <= 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"} left`
      }
    >
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r="16" className="lv-count-track" />
        <circle
          cx="20"
          cy="20"
          r="16"
          className="lv-count-left"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 - (left / span) * 100}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <b aria-hidden>{days <= 0 ? "!" : days}</b>
    </span>
  );
}

/* ── Signal bars: topic mastery 1–5 ───────────────────────────────────── */
export function SignalBars({
  level,
  max = 5,
}: {
  level: number;
  max?: number;
}) {
  const tone = level <= 1 ? "lv-low" : level <= 2 ? "lv-ok" : "lv-good";
  return (
    <span
      className={`lv-signal ${tone}`}
      aria-label={`Mastery ${level} of ${max}`}
    >
      {Array.from({ length: max }, (_, i) => (
        <i
          key={i}
          className={i < level ? "lv-on" : ""}
          style={{ height: `${5 + i * 3}px`, transitionDelay: `${i * 60}ms` }}
        />
      ))}
    </span>
  );
}

/* ── Rolling number: animates from the last value this device saw ────── */
export function RollingNumber({
  value,
  decimals = 1,
  memory,
  suffix = "%",
}: {
  value: number;
  decimals?: number;
  /** Remembers the last value shown, so a change rolls on next visit. */
  memory?: string;
  suffix?: string;
}) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState(0);
  useEffect(() => {
    let id = 0;
    let clear: ReturnType<typeof setTimeout> | undefined;
    id = requestAnimationFrame(() => {
      let from = value;
      try {
        const saved = memory ? localStorage.getItem("lv-roll:" + memory) : null;
        if (saved !== null && Number.isFinite(Number(saved)))
          from = Number(saved);
        if (memory) localStorage.setItem("lv-roll:" + memory, String(value));
      } catch {}
      if (
        from === value ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setShown(value);
        return;
      }
      setDelta(value - from);
      const start = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / 900);
        const e = 1 - Math.pow(1 - k, 3);
        setShown(from + (value - from) * e);
        if (k < 1) id = requestAnimationFrame(step);
      };
      id = requestAnimationFrame(step);
      clear = setTimeout(() => setDelta(0), 4000);
    });
    return () => {
      cancelAnimationFrame(id);
      if (clear) clearTimeout(clear);
    };
  }, [value, memory]);
  const f = 10 ** decimals;
  return (
    <span className="lv-roll">
      {(Math.round(shown * f) / f).toFixed(decimals)}
      {suffix}
      {delta !== 0 && (
        <small className={delta > 0 ? "lv-up" : "lv-down"}>
          {delta > 0 ? "+" : "−"}
          {Math.abs(Math.round(delta * f) / f).toFixed(decimals)}
        </small>
      )}
    </span>
  );
}

/* ── Avatar: photo or initials; a breathing ring when due ─────────────── */
export function Avatar({
  name,
  photo,
  due = false,
  size = 40,
}: {
  name: string;
  photo?: string | null;
  due?: boolean;
  size?: number;
}) {
  const initials = name
    .replace(/\[.*?\]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={`lv-avatar ${due ? "lv-due" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" />
      ) : (
        initials
      )}
    </span>
  );
}

/** Runs `then` after a short leaving animation on the element with `key`. */
export function useLeaving() {
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const run = async (key: string, then: () => Promise<void> | void) => {
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    setLeaving((s) => new Set(s).add(key));
    if (!reduce) await new Promise((r) => setTimeout(r, 520));
    try {
      await then();
    } finally {
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };
  return { isLeaving: (key: string) => leaving.has(key), run };
}
