"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { calendarRequest } from "./use-calendar";
import type {
  Health,
  SecurityCheck,
  ServiceState,
} from "@/lib/settings-overview";

/**
 * Settings shows its state: each graphic answers something you open
 * Settings to check. Status colours (green, amber, red) only mean status;
 * area colours only mark areas.
 */
export type Overview = {
  services: ServiceState[];
  security: SecurityCheck[];
  alerts: Record<string, string | null>;
  data: {
    groups: { key: string; label: string; count: number }[];
    total: number;
  };
  last_export: {
    finished_at: string;
    summary: {
      bytes: number;
      total: number;
      groups: { key: string; label: string; count: number }[];
    } | null;
  } | null;
  quiet: { start: string; end: string } | null;
};

export function useSettingsOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const load = useCallback(async () => {
    try {
      setOverview(await calendarRequest<Overview>("/api/v1/settings/overview"));
    } catch {
      // The graphics are a summary; each panel below still loads on its own.
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);
  return { overview, reload: load };
}

const ZONE = "America/Vancouver";

/** Ticks once a minute; the first value comes from the client. */
function useNow(every = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${suffix}`;
};

/* ---------- X2: one-line summary under the title ---------- */
export function SettingsSummary({ overview }: { overview: Overview | null }) {
  if (!overview) return <p className="st-summary muted small">Checking…</p>;
  const used = overview.services.filter((s) => s.health !== "off");
  const healthy = used.filter((s) => s.health === "ok").length;
  const latest = overview.services
    .map((s) => s.last_at)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const needs = overview.services.filter((s) => s.health === "warn");
  return (
    <p className="st-summary" role="status">
      {needs.length ? (
        <span className="st-needs">
          Needs you: {needs.map((s) => s.name).join(", ")}
        </span>
      ) : null}
      <span>
        <b>
          {healthy} of {used.length}
        </b>{" "}
        connections healthy
      </span>
      {latest && (
        <span>
          Last sync <b>{agoShort(latest)}</b>
        </span>
      )}
      {overview.quiet && (
        <span>
          Quiet hours{" "}
          <b>
            {clock(overview.quiet.start)}–{clock(overview.quiet.end)}
          </b>
        </span>
      )}
    </p>
  );
}

function agoShort(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/* ---------- C2: signal rows ---------- */
const BARS: Record<Health, number> = { ok: 4, warn: 2, off: 0 };
function Bars({ health, label }: { health: Health; label: string }) {
  return (
    <span className={`st-bars st-${health}`} role="img" aria-label={label}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < BARS[health] ? "on" : ""} />
      ))}
    </span>
  );
}
const HEALTH_LABEL: Record<Health, string> = {
  ok: "Working",
  warn: "Needs attention",
  off: "Not in use",
};

export function SignalRows({
  overview,
  onOpen,
}: {
  overview: Overview | null;
  onOpen: (id: ServiceState["id"]) => void;
}) {
  if (!overview) return null;
  return (
    <section
      className="panel settings-panel st-signals"
      aria-label="Connection health"
    >
      <h2>Connections at a glance</h2>
      <ul>
        {overview.services.map((s) => (
          <li key={s.id} className={s.health === "warn" ? "st-row-warn" : ""}>
            <Bars health={s.health} label={HEALTH_LABEL[s.health]} />
            <div>
              <strong>{s.name}</strong>
              <span className="small muted">{s.detail}</span>
            </div>
            <button
              type="button"
              className={`button ${s.health === "warn" ? "button-primary" : "button-outline"} button-sm`}
              onClick={() => onOpen(s.id)}
              aria-label={`${s.action}: ${s.name}`}
            >
              {s.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- C1: switchboard ---------- */
const SPOTS: [number, number][] = [
  [64, 44],
  [296, 44],
  [48, 156],
  [312, 156],
  [180, 206],
];
const SHORT: Record<ServiceState["id"], string> = {
  calendar: "Google Calendar",
  canvas: "SFU Canvas",
  email: "Course email",
  ai: "Gemini",
  sheets: "Google Sheets",
};
export function Switchboard({
  overview,
  onOpen,
}: {
  overview: Overview | null;
  onOpen: (id: ServiceState["id"]) => void;
}) {
  if (!overview) return null;
  // Fixed seats, so a service is always in the same place on the map.
  const order: ServiceState["id"][] = [
    "calendar",
    "canvas",
    "email",
    "ai",
    "sheets",
  ];
  const byId = new Map(overview.services.map((s) => [s.id, s]));
  return (
    <div className="st-switchboard" aria-label="Connections map">
      <svg viewBox="0 0 360 236" aria-hidden>
        {order.map((id, n) => {
          const s = byId.get(id);
          if (!s) return null;
          const [x, y] = SPOTS[n];
          return (
            <line
              key={id}
              x1={180}
              y1={118}
              x2={x}
              y2={y}
              className={`st-wire st-${s.health}`}
            />
          );
        })}
        <circle cx={180} cy={118} r={30} className="st-core" />
        <text x={180} y={122} textAnchor="middle" className="st-core-label">
          Life OS
        </text>
      </svg>
      {order.map((id, n) => {
        const s = byId.get(id);
        if (!s) return null;
        const [x, y] = SPOTS[n];
        return (
          <button
            key={id}
            type="button"
            className={`st-node st-${s.health}`}
            style={{ left: `${(x / 360) * 100}%`, top: `${(y / 236) * 100}%` }}
            onClick={() => onOpen(id)}
            aria-label={`${s.name}: ${HEALTH_LABEL[s.health]}. ${s.detail}`}
          >
            <i aria-hidden />
            <span>
              <b>{SHORT[id]}</b>
              <small>{nodeNote(s)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
function nodeNote(s: ServiceState) {
  if (s.health === "warn") return s.detail.split(" · ")[0];
  if (s.health === "off") return s.id === "sheets" ? "Not needed" : "Off";
  if (s.last_at) return agoShort(s.last_at);
  return s.detail.split(" · ").at(-1) ?? "";
}

/* ---------- A2: nameplate ---------- */
const AREA_OF_NAME: [RegExp, string][] = [
  [/school|academ|class|course/i, "school"],
  [/career|job|work/i, "career"],
  [/basketball|mbb|ball|athlet|team/i, "ball"],
  [/study|learn/i, "study"],
  [/gym|fitness|health|train/i, "gym"],
];
export const areaClassOf = (name: string) =>
  AREA_OF_NAME.find(([re]) => re.test(name))?.[1] ?? "other";

export function LocalClock() {
  const now = useNow(30_000);
  return (
    <span className="st-clock">
      <b>{formatInTimeZone(now, ZONE, "h:mm a")}</b>{" "}
      {formatInTimeZone(now, ZONE, "EEEE")} · Vancouver time
    </span>
  );
}

/* ---------- A1: pick by looking ---------- */
export function ThemePicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <fieldset className="st-looks">
      <legend>Appearance</legend>
      <div className="st-themes">
        {(["light", "dark", "system"] as const).map((t) => (
          <label key={t} className="st-look">
            <input
              type="radio"
              name="theme"
              value={t}
              defaultChecked={value === t}
              onChange={() => onPick(t)}
            />
            <span className={`st-screen st-screen-${t}`} aria-hidden>
              <i className="a" />
              <i />
              <i className="short" />
            </span>
            {t === "light" ? "Light" : t === "dark" ? "Dark" : "System"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function DensityPicker({ value }: { value: string }) {
  return (
    <fieldset className="st-looks">
      <legend>List density</legend>
      <div className="st-densities">
        {(["comfortable", "compact"] as const).map((d) => (
          <label key={d} className={`st-look st-density st-density-${d}`}>
            <input
              type="radio"
              name="density"
              value={d}
              defaultChecked={value === d}
            />
            <span className="st-lines" aria-hidden>
              {Array.from({ length: d === "compact" ? 5 : 3 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            {d === "comfortable" ? "Comfortable" : "Compact"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ---------- N1: quiet-hours dial ---------- */
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
/** A point on a 24-hour dial (midnight at the top). */
const onDial = (minute: number, r: number, c = 75) => {
  const a = (minute / 1440) * 2 * Math.PI - Math.PI / 2;
  return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
};
export function QuietDial({
  start,
  end,
}: {
  start: string | null;
  end: string | null;
}) {
  const now = useNow();
  const minute =
    Number(formatInTimeZone(now, ZONE, "H")) * 60 +
    Number(formatInTimeZone(now, ZONE, "m"));
  const s = start ? toMin(start) : null;
  const e = end ? toMin(end) : null;
  const span = s !== null && e !== null ? (e - s + 1440) % 1440 : 0;
  const quietNow =
    s !== null && e !== null
      ? s <= e
        ? minute >= s && minute < e
        : minute >= s || minute < e
      : false;
  const r = 58;
  const arc = (() => {
    if (s === null || !span) return null;
    const [x1, y1] = onDial(s, r);
    const [x2, y2] = onDial(s + span, r);
    return `M${x1} ${y1} A${r} ${r} 0 ${span > 720 ? 1 : 0} 1 ${x2} ${y2}`;
  })();
  const [hx, hy] = onDial(minute, 44);
  return (
    <div className="st-dial">
      <svg
        viewBox="0 0 150 150"
        role="img"
        aria-label={
          start && end
            ? `Quiet hours ${clock(start)} to ${clock(end)}`
            : "No quiet hours"
        }
      >
        <circle cx={75} cy={75} r={r} className="st-dial-track" />
        {arc && <path d={arc} className="st-dial-quiet" />}
        <line x1={75} y1={75} x2={hx} y2={hy} className="st-dial-hand" />
        <circle cx={75} cy={75} r={4} className="st-dial-pin" />
        {[
          [0, "12a"],
          [360, "6a"],
          [720, "12p"],
          [1080, "6p"],
        ].map(([m, label]) => {
          const [x, y] = onDial(Number(m), 33);
          return (
            <text
              key={label}
              x={x}
              y={y + 3}
              textAnchor="middle"
              className="st-dial-tick"
            >
              {label}
            </text>
          );
        })}
      </svg>
      <ul>
        <li>
          <span>Quiet hours</span>
          <b>{start && end ? `${clock(start)}–${clock(end)}` : "Off"}</b>
        </li>
        <li>
          <span>Now</span>
          <b>{formatInTimeZone(now, ZONE, "h:mm a")}</b>
        </li>
        <li className="small muted">
          {quietNow
            ? "Quiet now: reminders wait until quiet hours end."
            : "Reminders can reach you now."}
        </li>
      </ul>
    </div>
  );
}

/* ---------- S1: lock checklist ---------- */
export function LockChecklist({
  checks,
  onFix,
}: {
  checks: SecurityCheck[] | undefined;
  onFix: (id: string) => void;
}) {
  if (!checks) return null;
  const on = checks.filter((c) => c.on).length;
  const closed = on === checks.length;
  return (
    <section className="panel settings-panel st-lock" aria-label="Protections">
      <svg
        viewBox="0 0 84 84"
        role="img"
        aria-label={`${on} of ${checks.length} protections on`}
        className={closed ? "st-closed" : "st-open"}
      >
        <path
          d={
            closed
              ? "M26 40 V28 a16 16 0 0 1 32 0 V40"
              : "M26 40 V28 a16 16 0 0 1 32 0 V32"
          }
          className="st-shackle"
          transform={closed ? undefined : "translate(0 -5)"}
        />
        <rect x={16} y={38} width={52} height={38} rx={9} className="st-body" />
        <text x={42} y={63} textAnchor="middle" className="st-lock-count">
          {on}/{checks.length}
        </text>
      </svg>
      <div>
        <h2>{closed ? "Everything's on" : "One thing left to turn on"}</h2>
        <ul className="st-checks">
          {checks.map((c) => (
            <li key={c.id}>
              <span className={c.on ? "st-yes" : "st-no"} aria-hidden>
                {c.on ? "✓" : "!"}
              </span>
              <span>
                {c.label}
                <span className="sr-only">{c.on ? " (on)" : " (off)"}</span>
              </span>
              {!c.on && c.id === "mfa" && (
                <button
                  type="button"
                  className="button button-outline button-sm"
                  onClick={() => onFix(c.id)}
                >
                  Turn on
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- D1: what's stored ---------- */
const GROUP_TONE: Record<string, string> = {
  school: "var(--area-school)",
  career: "var(--area-career)",
  tasks: "color-mix(in srgb, var(--text) 70%, var(--surface))",
  calendar: "color-mix(in srgb, var(--text) 45%, var(--surface))",
  reviews: "color-mix(in srgb, var(--text) 25%, var(--surface))",
};
const n = (x: number) => x.toLocaleString("en-CA");
export function StoredBar({ overview }: { overview: Overview | null }) {
  if (!overview) return <p className="muted small">Counting your records…</p>;
  const { groups, total } = overview.data;
  return (
    <div className="st-stored">
      <div
        className="st-stack"
        role="img"
        aria-label={groups.map((g) => `${g.label} ${n(g.count)}`).join(", ")}
      >
        {groups
          .filter((g) => g.count)
          .map((g) => (
            <i
              key={g.key}
              style={{ flexGrow: g.count, background: GROUP_TONE[g.key] }}
            />
          ))}
      </div>
      <ul className="st-stack-legend">
        {groups.map((g) => (
          <li key={g.key}>
            <i style={{ background: GROUP_TONE[g.key] }} aria-hidden />
            {g.label}
            <b>{n(g.count)}</b>
          </li>
        ))}
      </ul>
      <p className="small muted">
        {n(total)} records · passwords and sign-in keys are never included
      </p>
    </div>
  );
}

/* ---------- D2: export receipt ---------- */
const size = (bytes: number) =>
  bytes > 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
export function ExportReceipt({ overview }: { overview: Overview | null }) {
  const last = overview?.last_export;
  if (!overview) return null;
  if (!last?.summary)
    return (
      <p className="small muted st-receipt-none">
        No export yet. After you export, a receipt of what left appears here.
      </p>
    );
  const s = last.summary;
  return (
    <figure className="st-receipt" aria-label="Last export">
      <div className="st-r">
        <span>LIFE OS EXPORT</span>
        <span>
          {formatInTimeZone(
            last.finished_at,
            ZONE,
            "MMM d, h:mm a",
          ).toUpperCase()}
        </span>
      </div>
      <hr />
      {s.groups.map((g) => (
        <div className="st-r" key={g.key}>
          <span>{g.label}</span>
          <span>{n(g.count)}</span>
        </div>
      ))}
      <hr />
      <div className="st-r">
        <span>ALL RECORDS</span>
        <span>{n(s.total)}</span>
      </div>
      <div className="st-r">
        <span>SIZE</span>
        <span>{size(s.bytes)}</span>
      </div>
    </figure>
  );
}

/* ---------- Drag handles (P1, P2) ---------- */
/**
 * A handle on a track that moves in steps by pointer or arrow keys. The
 * track is the handle's offset parent.
 */
export function TrackHandle({
  value,
  min,
  max,
  step = 1,
  label,
  text,
  track,
  onChange,
  className = "",
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  text: string;
  /** Range the track spans, in the same units as value. */
  track: [number, number];
  onChange: (v: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const clamp = (v: number) =>
    Math.min(max, Math.max(min, Math.round(v / step) * step));
  const at = ((value - track[0]) / (track[1] - track[0])) * 100;
  return (
    <span
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      className={`st-handle ${className}`}
      style={{ left: `${at}%` }}
      onKeyDown={(e) => {
        const d =
          e.key === "ArrowRight" || e.key === "ArrowUp"
            ? step
            : e.key === "ArrowLeft" || e.key === "ArrowDown"
              ? -step
              : 0;
        if (d) {
          e.preventDefault();
          onChange(clamp(value + d));
        }
      }}
      onPointerDown={(e) => {
        const parent = ref.current?.parentElement;
        if (!parent) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const box = parent.getBoundingClientRect();
          const f = (ev.clientX - box.left) / box.width;
          onChange(clamp(track[0] + f * (track[1] - track[0])));
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}
