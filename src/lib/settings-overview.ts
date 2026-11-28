/**
 * The one-glance state of Settings: each connection's health, the
 * protections that are on, and what Life OS stores. Pure, so the rules
 * that turn a tab amber are tested in one place.
 */
export type Health = "ok" | "warn" | "off";

export type ServiceState = {
  id: "calendar" | "canvas" | "email" | "ai" | "sheets";
  name: string;
  health: Health;
  detail: string;
  /** Last successful sync or use, ISO. */
  last_at: string | null;
  action: string;
};

export type OverviewInput = {
  now: number;
  calendar: {
    connections: { status: string; last_sync_at: string | null }[];
    selected: number;
  };
  canvas: {
    connected: boolean;
    enabled: boolean;
    expires_at: string | null;
    last_sync_at: string | null;
    courses: number;
  };
  email: { created_at: string; last_used_at: string | null } | null;
  ai: {
    configured: boolean;
    enabled: boolean;
    requests: number;
    limit: number;
  };
  sheets: { linked: number };
};

const HOUR = 3600000;

/** "4 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | null, now: number) {
  if (!iso) return null;
  const ms = Math.max(0, now - Date.parse(iso));
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(ms / HOUR);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(ms / (24 * HOUR));
  return `${d} days ago`;
}

const plural = (n: number, one: string, many = one + "s") =>
  `${n} ${n === 1 ? one : many}`;

export function serviceStates(i: OverviewInput): ServiceState[] {
  const out: ServiceState[] = [];

  // Google Calendar
  const live = i.calendar.connections.filter((c) => c.status === "connected");
  const broken = i.calendar.connections.some((c) =>
    ["error", "revoked"].includes(c.status),
  );
  const calSync =
    live
      .map((c) => c.last_sync_at)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  const calStale = !!calSync && i.now - Date.parse(calSync) > 48 * HOUR;
  out.push(
    !live.length && !broken
      ? {
          id: "calendar",
          name: "Google Calendar",
          health: "off",
          detail: "Not connected",
          last_at: null,
          action: "Connect",
        }
      : broken && !live.length
        ? {
            id: "calendar",
            name: "Google Calendar",
            health: "warn",
            detail: "Google stopped sharing your calendars",
            last_at: calSync,
            action: "Reconnect",
          }
        : {
            id: "calendar",
            name: "Google Calendar",
            health: calStale ? "warn" : "ok",
            detail: `${plural(i.calendar.selected, "calendar")} · ${
              calSync
                ? (calStale ? "last synced " : "synced ") + ago(calSync, i.now)
                : "not synced yet"
            }`,
            last_at: calSync,
            action: calStale ? "Sync now" : "Manage",
          },
  );

  // Canvas
  const c = i.canvas;
  const daysLeft = c.expires_at
    ? Math.ceil((Date.parse(c.expires_at) - i.now) / (24 * HOUR))
    : null;
  out.push(
    !c.connected
      ? {
          id: "canvas",
          name: "SFU Canvas",
          health: "off",
          detail: "Not connected",
          last_at: null,
          action: "Connect",
        }
      : daysLeft !== null && daysLeft <= 0
        ? {
            id: "canvas",
            name: "SFU Canvas",
            health: "warn",
            detail: "Token expired · grades and deadlines paused",
            last_at: c.last_sync_at,
            action: "Reconnect",
          }
        : !c.enabled
          ? {
              id: "canvas",
              name: "SFU Canvas",
              health: "warn",
              detail: "Paused · grades and deadlines aren't updating",
              last_at: c.last_sync_at,
              action: "Resume",
            }
          : {
              id: "canvas",
              name: "SFU Canvas",
              health: daysLeft !== null && daysLeft <= 3 ? "warn" : "ok",
              detail: [
                plural(c.courses, "course"),
                c.last_sync_at
                  ? "synced " + ago(c.last_sync_at, i.now)
                  : "not synced yet",
                daysLeft !== null && daysLeft <= 7
                  ? `token expires in ${plural(daysLeft, "day")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
              last_at: c.last_sync_at,
              action:
                daysLeft !== null && daysLeft <= 3 ? "New token" : "Manage",
            },
  );

  // Course email
  out.push(
    !i.email
      ? {
          id: "email",
          name: "Course email",
          health: "off",
          detail: "Not set up · forward SFU mail to bring in updates",
          last_at: null,
          action: "Set up",
        }
      : {
          id: "email",
          name: "Course email",
          health: i.email.last_used_at ? "ok" : "off",
          detail: i.email.last_used_at
            ? "Latest email synced"
            : "Set up · no email received yet",
          last_at: i.email.last_used_at,
          action: "Manage",
        },
  );

  // Gemini
  out.push(
    !i.ai.configured
      ? {
          id: "ai",
          name: "Gemini · weekly review",
          health: "warn",
          detail: "Key missing · add GEMINI_API_KEY in Vercel",
          last_at: null,
          action: "Settings",
        }
      : !i.ai.enabled
        ? {
            id: "ai",
            name: "Gemini · weekly review",
            health: "off",
            detail: "Off",
            last_at: null,
            action: "Turn on",
          }
        : {
            id: "ai",
            name: "Gemini · weekly review",
            health: "ok",
            detail: `On · ${i.ai.requests} of ${i.ai.limit} messages today`,
            last_at: null,
            action: "Settings",
          },
  );

  // Sheets
  out.push(
    i.sheets.linked
      ? {
          id: "sheets",
          name: "Google Sheets",
          health: "ok",
          detail: `${plural(i.sheets.linked, "table")} linked`,
          last_at: null,
          action: "Manage",
        }
      : {
          id: "sheets",
          name: "Google Sheets",
          health: "off",
          detail: "Optional · career records live in Growth",
          last_at: null,
          action: "Import",
        },
  );
  // Whatever needs you comes first; otherwise keep the fixed order.
  return out
    .map((s, n) => ({ s, n }))
    .sort(
      (a, b) =>
        Number(b.s.health === "warn") - Number(a.s.health === "warn") ||
        a.n - b.n,
    )
    .map((x) => x.s);
}

export type SecurityCheck = { id: string; label: string; on: boolean };

export function securityChecks(i: {
  password: boolean;
  mfa: boolean;
}): SecurityCheck[] {
  return [
    { id: "password", label: "Password sign-in", on: i.password },
    { id: "approved", label: "Only your account can open Life OS", on: true },
    { id: "mfa", label: "Two-step sign-in", on: i.mfa },
  ];
}

/** Which Settings tabs need you: a tab only gets a dot when something there does. */
export function tabAlerts(
  services: ServiceState[],
  checks: SecurityCheck[],
): Record<string, string | null> {
  const warn = services.filter((s) => s.health === "warn");
  const off = checks.filter((c) => !c.on);
  return {
    integrations: warn.length
      ? warn.map((s) => `${s.name}: ${s.detail}`).join(". ")
      : null,
    privacy: off.length ? off.map((c) => `${c.label} is off`).join(". ") : null,
  };
}

/** Record groups for the Data tab, in the order they're drawn. */
export const DATA_GROUPS = [
  {
    key: "school",
    label: "School & Canvas",
    tables: ["canvas_records", "courses", "assessments"],
  },
  { key: "tasks", label: "Tasks", tables: ["tasks"] },
  { key: "calendar", label: "Calendar events", tables: ["calendar_events"] },
  {
    key: "career",
    label: "Career & people",
    tables: ["career_entries", "contacts", "contact_interactions"],
  },
  {
    key: "reviews",
    label: "Reviews & conversations",
    tables: ["reviews", "assistant_conversations"],
  },
] as const;
