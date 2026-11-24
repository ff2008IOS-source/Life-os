import { formatInTimeZone } from "date-fns-tz";

/**
 * Career follow-ups from the Professional contacts sheet, and application
 * deadlines from the Application pipeline sheet. Sheets store dates as
 * serial day numbers (days since 1899-12-30) or as text.
 */
const ZONE = "America/Vancouver";
const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;

/** Today's date as a sheet serial day number, in Vancouver time. */
export function todaySerial(now = new Date()) {
  const d = formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  return Math.round((Date.parse(d + "T00:00:00Z") - EPOCH) / DAY);
}

/** A sheet cell as a yyyy-MM-dd date, or null when it isn't a date. */
export function sheetDate(value: unknown): string | null {
  if (typeof value === "number" && value > 20000 && value < 80000)
    return new Date(EPOCH + Math.round(value) * DAY).toISOString().slice(0, 10);
  if (typeof value === "string") {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    const ms = Date.parse(value);
    if (/\d{4}/.test(value) && Number.isFinite(ms))
      return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

export type SheetRow = {
  id: string;
  version: number;
  dataset_id: string;
  state?: string;
  local_values: Record<string, unknown>;
};

export type FollowUp = {
  row_id: string;
  version: number;
  dataset_id: string;
  name: string;
  role: string;
  organization: string;
  last_contact: string | null;
  days_since: number | null;
  note: string;
  due: boolean;
  /** The Life OS contact record that logs conversations, when one exists. */
  record: { id: string; version: number } | null;
};

/** A conversation logged in Life OS for a sheet contact. */
export type ContactLog = {
  id: string;
  version: number;
  source_key: string | null;
  last_contact_at: string | null;
};
export const contactKey = (rowId: string) => `sheet-row:${rowId}`;

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Who to check in with. A contact is due when nobody has logged a
 * conversation, or the last one was `cadence` or more days ago. Due contacts
 * come first: never contacted, then longest since contact.
 */
export function followUps(
  rows: SheetRow[],
  now = new Date(),
  cadence = 30,
  logs: ContactLog[] = [],
) {
  const today = todaySerial(now);
  return rows
    .filter((r) => r.state !== "deleted" && text(r.local_values.name).trim())
    .map((r): FollowUp => {
      const v = r.local_values;
      const log = logs.find((l) => l.source_key === contactKey(r.id));
      const logged = log?.last_contact_at
        ? formatInTimeZone(log.last_contact_at, ZONE, "yyyy-MM-dd")
        : null;
      const sheet = sheetDate(v.last_contact);
      const last =
        sheet && logged ? (sheet > logged ? sheet : logged) : (sheet ?? logged);
      const days =
        last === null
          ? null
          : today - Math.round((Date.parse(last + "T00:00:00Z") - EPOCH) / DAY);
      return {
        row_id: r.id,
        version: r.version,
        dataset_id: r.dataset_id,
        name: text(v.name).trim(),
        role: text(v.role),
        organization: text(v.organization),
        last_contact: last,
        days_since: days,
        note: text(v.next_followup),
        due: days === null || days >= cadence,
        record: log ? { id: log.id, version: log.version } : null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.due) - Number(a.due) ||
        (b.days_since ?? Infinity) - (a.days_since ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
}

export type ApplicationDeadline = {
  row_id: string;
  title: string;
  status: string;
  deadline: string;
};

/**
 * Applications with a deadline column (any column whose key mentions
 * deadline, due or "apply by"), soonest first, skipping ones already decided.
 */
export function applicationDeadlines(rows: SheetRow[], now = new Date()) {
  const today = formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  const out: ApplicationDeadline[] = [];
  for (const r of rows) {
    if (r.state === "deleted") continue;
    const v = r.local_values;
    const key = Object.keys(v).find((k) => /deadline|due|apply_?by/i.test(k));
    const deadline = key ? sheetDate(v[key]) : null;
    const status = text(v.status);
    if (!deadline || deadline < today) continue;
    if (/applied|submitted|offer|rejected|declined|closed/i.test(status))
      continue;
    out.push({
      row_id: r.id,
      title: text(v.organization_role ?? v.organization ?? v.role ?? v.title),
      status,
      deadline,
    });
  }
  return out.sort((a, b) => a.deadline.localeCompare(b.deadline));
}
