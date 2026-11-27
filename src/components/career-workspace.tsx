"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Plus,
  Pencil,
  MessageSquare,
  Award,
} from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { Modal } from "./dialog";
import { friendlyDate } from "@/lib/dates";
import { Avatar } from "./living";
import { followUpDue } from "@/lib/career/follow-up-rule";

/**
 * Growth → Career: where career records are kept and updated. One page,
 * a few sections (People · Applications · Skills & portfolio · Plans ·
 * Reference); nothing here reads a spreadsheet.
 */
type Entry = {
  id: string;
  version: number;
  kind: string;
  title: string;
  status: string;
  due_date: string | null;
  details: Record<string, unknown>;
  updated_at: string;
};
type Contact = {
  id: string;
  version: number;
  name: string;
  organization: string | null;
  role: string | null;
  how_met: string | null;
  relationship_notes: string;
  last_contact_at: string | null;
  next_follow_up_date: string | null;
  photo?: string | null;
};
type Interaction = {
  id: string;
  contact_id: string;
  occurred_on: string;
  summary: string;
  next_follow_up_date: string | null;
};
type Data = {
  entries: Entry[];
  contacts: Contact[];
  interactions: Interaction[];
};

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const post = (body: unknown) =>
  calendarRequest("/api/v1/career/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useCareer() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await calendarRequest<Data>("/api/v1/career/records"));
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Career records couldn't load.",
      );
    }
  }, []);
  useEffect(() => {
    let live = true;
    calendarRequest<Data>("/api/v1/career/records")
      .then((d) => live && setData(d))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof Error ? e.message : "Career records couldn't load.",
          ),
      );
    return () => {
      live = false;
    };
  }, []);
  const act = useCallback(
    async (body: unknown) => {
      await post(body);
      await load();
    },
    [load],
  );
  return { data, error, act };
}

const SECTIONS = [
  ["people", "People"],
  ["applications", "Applications"],
  ["skills", "Skills & portfolio"],
  ["plans", "Plans"],
  ["reference", "Reference"],
] as const;
type Section = (typeof SECTIONS)[number][0];

const APP_STATUSES = [
  "Drafting",
  "Submitted",
  "Interviewing",
  "Offer",
  "Accepted",
  "Rejected",
  "Withdrawn",
];
const WORK_STATUSES = ["Not Started", "In Progress", "Complete", "On Hold"];

type Field = { key: string; label: string; long?: boolean };
const FIELDS: Record<string, Field[]> = {
  application: [
    { key: "type", label: "Type" },
    { key: "notes", label: "Notes", long: true },
  ],
  application_target: [
    { key: "type", label: "Type" },
    { key: "notes", label: "Notes", long: true },
  ],
  skill: [
    { key: "level", label: "Current level" },
    { key: "target", label: "Target" },
    { key: "rhythm", label: "Practice rhythm" },
  ],
  portfolio_project: [
    { key: "area", label: "Area" },
    { key: "next_step", label: "Next step", long: true },
  ],
  career_goal: [
    { key: "semester", label: "Semester" },
    { key: "area", label: "Area" },
    { key: "metric", label: "Metric" },
    { key: "priority", label: "Priority" },
    { key: "next_action", label: "Next action", long: true },
    { key: "evidence", label: "Evidence", long: true },
    { key: "notes", label: "Notes", long: true },
  ],
  roadmap: [
    { key: "mission", label: "Mission", long: true },
    { key: "academics", label: "Academics", long: true },
    { key: "basketball", label: "Basketball", long: true },
    { key: "career_skills", label: "Career skills", long: true },
    { key: "experience", label: "Experience", long: true },
    { key: "networking", label: "Networking", long: true },
    { key: "portfolio", label: "Portfolio", long: true },
    { key: "success_test", label: "Success test", long: true },
  ],
  coop_term: [
    { key: "objective", label: "Objective", long: true },
    { key: "target_roles", label: "Target roles", long: true },
    { key: "application_window", label: "Application window" },
    { key: "skills_needed", label: "Skills needed", long: true },
    { key: "success_metric", label: "Success metric", long: true },
    { key: "notes", label: "Notes", long: true },
  ],
};
const NOUN: Record<string, string> = {
  application: "application",
  application_target: "target employer",
  skill: "skill",
  portfolio_project: "project",
  career_goal: "semester goal",
  roadmap: "roadmap year",
  coop_term: "co-op term",
};

/** One editor for every kind of career record. */
function EntryEditor({
  entry,
  kind,
  onClose,
  act,
  preset,
}: {
  entry: Entry | null;
  kind: string;
  onClose: () => void;
  act: (b: unknown) => Promise<void>;
  preset?: Partial<Entry>;
}) {
  const base = entry ?? (preset as Entry | undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const statuses =
    kind === "application"
      ? APP_STATUSES
      : kind === "application_target"
        ? ["Research", "Contacted", "Applied", "Not pursuing"]
        : WORK_STATUSES;
  const current =
    base?.status && base.status !== "unknown" ? base.status : statuses[0];
  return (
    <Modal
      open
      title={entry ? `Edit ${NOUN[kind]}` : `New ${NOUN[kind]}`}
      description="Saved to your Life OS account."
      onOpenChange={(o) => !o && onClose()}
    >
      <form
        className="career-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await act({
              action: "save_entry",
              ...(entry ? { id: entry.id, version: entry.version } : {}),
              kind,
              title: String(f.get("title")),
              status: String(f.get("status")),
              due_date: String(f.get("due_date") || "") || null,
              details: {
                ...(preset?.details ?? {}),
                ...Object.fromEntries(
                  (FIELDS[kind] ?? []).map((x) => [
                    x.key,
                    String(f.get(x.key) ?? "") || null,
                  ]),
                ),
              },
            });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {kind === "application" || kind === "application_target"
            ? "Organization / role"
            : "Title"}
          <input
            name="title"
            required
            maxLength={300}
            defaultValue={base?.title ?? ""}
          />
        </label>
        <div className="career-form-row">
          <label>
            Status
            <select name="status" defaultValue={current}>
              {[...new Set([current, ...statuses])].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {kind !== "roadmap" && kind !== "coop_term" && kind !== "skill" && (
            <label>
              {kind === "application" ? "Deadline" : "Target date"}
              <input
                name="due_date"
                type="date"
                defaultValue={base?.due_date ?? ""}
              />
            </label>
          )}
        </div>
        {(FIELDS[kind] ?? []).map((x) => (
          <label key={x.key}>
            {x.label}
            {x.long ? (
              <textarea
                name={x.key}
                rows={2}
                defaultValue={str(base?.details?.[x.key])}
              />
            ) : (
              <input name={x.key} defaultValue={str(base?.details?.[x.key])} />
            )}
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <div className="career-form-actions">
          {entry && (
            <button
              type="button"
              className="td-link td-link-muted"
              onClick={async () => {
                await act({ action: "archive_entry", id: entry.id });
                onClose();
              }}
            >
              Archive
            </button>
          )}
          <button className="td-btn td-btn-dark td-btn-sm" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Crops an image to a centred square and shrinks it to 192 px (JPEG). */
async function squarePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    192,
    192,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function ContactEditor({
  contact,
  onClose,
  act,
}: {
  contact: Contact | null;
  onClose: () => void;
  act: (b: unknown) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<string | null>(contact?.photo ?? null);
  const [name, setName] = useState(contact?.name ?? "");
  return (
    <Modal
      open
      title={contact ? `Edit ${contact.name}` : "New person"}
      description="Saved to your Life OS account."
      onOpenChange={(o) => !o && onClose()}
    >
      <form
        className="career-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await act({
              action: "save_contact",
              ...(contact ? { id: contact.id, version: contact.version } : {}),
              name: String(f.get("name")),
              organization: String(f.get("organization") || "") || null,
              role: String(f.get("role") || "") || null,
              how_met: String(f.get("how_met") || "") || null,
              relationship_notes: String(f.get("relationship_notes") || ""),
              next_follow_up_date:
                String(f.get("next_follow_up_date") || "") || null,
              photo,
            });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save.");
          }
        }}
      >
        <div className="career-photo">
          <Avatar name={name || "?"} photo={photo} size={64} />
          <div className="career-photo-actions">
            <label className="td-btn td-btn-ghost td-btn-sm">
              {photo ? "Change photo" : "Add photo"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="Profile picture"
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (!file) return;
                  try {
                    setPhoto(await squarePhoto(file));
                    setError("");
                  } catch {
                    setError("That image couldn't be read. Try a JPEG or PNG.");
                  }
                }}
              />
            </label>
            {photo && (
              <button
                type="button"
                className="td-link td-link-muted"
                onClick={() => setPhoto(null)}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
        <label>
          Name
          <input
            name="name"
            required
            defaultValue={contact?.name ?? ""}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <div className="career-form-row">
          <label>
            Organization
            <input
              name="organization"
              defaultValue={contact?.organization ?? ""}
            />
          </label>
          <label>
            Role
            <input name="role" defaultValue={contact?.role ?? ""} />
          </label>
        </div>
        <label>
          How you met
          <input name="how_met" defaultValue={contact?.how_met ?? ""} />
        </label>
        <label>
          Next follow-up
          <input
            name="next_follow_up_date"
            type="date"
            defaultValue={contact?.next_follow_up_date ?? ""}
          />
        </label>
        <label>
          Notes
          <textarea
            name="relationship_notes"
            rows={3}
            defaultValue={contact?.relationship_notes ?? ""}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="career-form-actions">
          {contact && (
            <button
              type="button"
              className="td-link td-link-muted"
              onClick={async () => {
                await act({ action: "archive_contact", id: contact.id });
                onClose();
              }}
            >
              Archive
            </button>
          )}
          <button className="td-btn td-btn-dark td-btn-sm">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function LogConversation({
  contact,
  onClose,
  act,
}: {
  contact: Contact;
  onClose: () => void;
  act: (b: unknown) => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <Modal
      open
      title={`Log a conversation with ${contact.name}`}
      description="It updates their last contact and schedules the next follow-up."
      onOpenChange={(o) => !o && onClose()}
    >
      <form
        className="career-form"
        aria-label="Log a conversation"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await act({
              action: "log_conversation",
              contact_id: contact.id,
              occurred_on: String(f.get("occurred_on")),
              summary: String(f.get("summary")),
              next_follow_up_date: String(f.get("next") || "") || null,
            });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save.");
          }
        }}
      >
        <label>
          When
          <input
            name="occurred_on"
            type="date"
            required
            defaultValue={today()}
          />
        </label>
        <label>
          What you talked about
          <textarea name="summary" rows={3} required />
        </label>
        <label>
          Next follow-up
          <input name="next" type="date" />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="career-form-actions">
          <button className="td-btn td-btn-dark td-btn-sm">
            Save conversation
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EvidenceEditor({
  entry,
  onClose,
  act,
}: {
  entry: Entry;
  onClose: () => void;
  act: (b: unknown) => Promise<void>;
}) {
  return (
    <Modal
      open
      title={`Add evidence · ${entry.title}`}
      description="A dated note of real progress (a model built, a lesson finished, feedback received)."
      onOpenChange={(o) => !o && onClose()}
    >
      <form
        className="career-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await act({
            action: "add_evidence",
            id: entry.id,
            date: String(f.get("date")),
            text: String(f.get("text")),
          });
          onClose();
        }}
      >
        <label>
          Date
          <input name="date" type="date" required defaultValue={today()} />
        </label>
        <label>
          Evidence
          <textarea name="text" rows={3} required />
        </label>
        <div className="career-form-actions">
          <button className="td-btn td-btn-dark td-btn-sm">Add evidence</button>
        </div>
      </form>
    </Modal>
  );
}

/** A record the workbook later disagreed with: shown so the owner decides. */
function Differs({
  entry,
  act,
}: {
  entry: Entry;
  act: (b: unknown) => Promise<void>;
}) {
  const wb = entry.details._workbook as Record<string, unknown> | undefined;
  if (!wb) return null;
  return (
    <p className="career-differs">
      The workbook says “{str(wb.status)}”
      {wb.due_date ? `, ${friendlyDate(str(wb.due_date))}` : ""}.{" "}
      <button
        className="td-link"
        onClick={() =>
          void act({
            action: "save_entry",
            id: entry.id,
            version: entry.version,
            kind: entry.kind,
            title: str(wb.title) || entry.title,
            status: str(wb.status) || entry.status,
            due_date: (wb.due_date as string | null) ?? null,
            details: (wb.details as Record<string, unknown>) ?? {},
          })
        }
      >
        Use the workbook’s
      </button>{" "}
      ·{" "}
      <button
        className="td-link td-link-muted"
        onClick={() =>
          void act({
            action: "save_entry",
            id: entry.id,
            version: entry.version,
            kind: entry.kind,
            title: entry.title,
            status: entry.status,
            due_date: entry.due_date,
            details: {},
          })
        }
      >
        Keep mine
      </button>
    </p>
  );
}

function Row({
  entry,
  onEdit,
  act,
  meta,
  extra,
}: {
  entry: Entry;
  onEdit: () => void;
  act: (b: unknown) => Promise<void>;
  meta: string;
  extra?: React.ReactNode;
}) {
  return (
    <li className="career-row">
      <div className="career-row-main">
        <strong>{entry.title}</strong>
        <span className="career-meta">{meta}</span>
        {extra}
        <Differs entry={entry} act={act} />
      </div>
      <button
        className="td-link td-link-muted"
        onClick={onEdit}
        aria-label={`Edit ${entry.title}`}
      >
        <Pencil size={14} aria-hidden /> Edit
      </button>
    </li>
  );
}

export function CareerWorkspace() {
  const { data, error, act } = useCareer();
  const [section, setSection] = useState<Section>("people");
  const [edit, setEdit] = useState<{
    kind: string;
    entry: Entry | null;
    preset?: Partial<Entry>;
  } | null>(null);
  const [person, setPerson] = useState<Contact | null | "new">(null);
  const [log, setLog] = useState<Contact | null>(null);
  const [evidence, setEvidence] = useState<Entry | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const of = useMemo(
    () => (kind: string) =>
      (data?.entries ?? []).filter((e) => e.kind === kind),
    [data],
  );
  if (error) return <p className="course-empty">{error}</p>;
  if (!data)
    return <p className="course-empty">Loading your career records…</p>;
  const t = today();
  const add = (kind: string, preset?: Partial<Entry>) => (
    <button
      className="td-link"
      onClick={() => setEdit({ kind, entry: null, preset })}
    >
      <Plus size={14} aria-hidden /> Add {NOUN[kind]}
    </button>
  );
  const apps = of("application");
  const semesters = [
    ...new Set(
      of("career_goal").map((g) => str(g.details.semester) || "Other"),
    ),
  ];
  return (
    <section className="panel career-workspace" aria-label="Career">
      <div className="career-tabs" role="tablist" aria-label="Career sections">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={section === id}
            className={section === id ? "active" : ""}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "people" && (
        <div className="career-section">
          <div className="career-section-head">
            <h2>People</h2>
            <button className="td-link" onClick={() => setPerson("new")}>
              <Plus size={14} aria-hidden /> Add person
            </button>
          </div>
          <ul className="career-list">
            {data.contacts.map((c) => {
              const history = data.interactions.filter(
                (i) => i.contact_id === c.id,
              );
              const since = c.last_contact_at
                ? Math.round(
                    (Date.parse(t + "T12:00:00Z") -
                      Date.parse(
                        c.last_contact_at.slice(0, 10) + "T12:00:00Z",
                      )) /
                      86400000,
                  )
                : null;
              const due = followUpDue(c, t, since);
              return (
                <li key={c.id} className="career-row career-person">
                  <button
                    type="button"
                    className="career-avatar-btn"
                    onClick={() => setPerson(c)}
                    aria-label={`${c.photo ? "Change" : "Add"} a photo for ${c.name}`}
                  >
                    <Avatar name={c.name} photo={c.photo} due={due} />
                  </button>
                  <div className="career-row-main">
                    <button
                      className="career-name"
                      aria-expanded={open === c.id}
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                    >
                      {c.name}
                    </button>
                    <span className="career-meta">
                      {[c.role, c.organization].filter(Boolean).join(" · ")}
                    </span>
                    <span className={`career-meta ${due ? "career-due" : ""}`}>
                      {c.next_follow_up_date
                        ? `Follow up ${friendlyDate(c.next_follow_up_date)}`
                        : due
                          ? since !== null
                            ? `${since} days since you talked · follow up`
                            : "Follow-up noted, no date yet"
                          : "No follow-up set"}
                      {c.last_contact_at
                        ? ` · last talked ${friendlyDate(c.last_contact_at.slice(0, 10))}`
                        : ""}
                    </span>
                    {open === c.id && (
                      <div className="career-detail">
                        {c.how_met && <p>Met: {c.how_met}</p>}
                        {c.relationship_notes && (
                          <p className="career-notes">{c.relationship_notes}</p>
                        )}
                        {history.length ? (
                          <ul className="career-history">
                            {history.map((h) => (
                              <li key={h.id}>
                                <strong>{friendlyDate(h.occurred_on)}</strong>{" "}
                                {h.summary}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="career-meta">
                            No conversations logged yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="career-actions">
                    <button
                      className="td-btn td-btn-ghost td-btn-sm"
                      onClick={() => setLog(c)}
                      aria-label={`Log a conversation with ${c.name}`}
                    >
                      <MessageSquare size={14} aria-hidden /> Log
                    </button>
                    <button
                      className="td-link td-link-muted"
                      onClick={() => setPerson(c)}
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil size={14} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!data.contacts.length && (
            <p className="course-empty">No people yet.</p>
          )}
        </div>
      )}

      {section === "applications" && (
        <div className="career-section">
          <div className="career-section-head">
            <h2>Applications</h2>
            {add("application")}
          </div>
          <ul className="career-list">
            {apps.map((a) => (
              <Row
                key={a.id}
                entry={a}
                act={act}
                onEdit={() => setEdit({ kind: "application", entry: a })}
                meta={[
                  a.status,
                  a.due_date
                    ? `deadline ${friendlyDate(a.due_date)}`
                    : "no deadline",
                ].join(" · ")}
              />
            ))}
          </ul>
          {!apps.length && (
            <p className="course-empty">
              No applications yet. Target employers are below; start one when
              there’s a real opening.
            </p>
          )}
          <div className="career-section-head">
            <h3>Target employers</h3>
            {add("application_target")}
          </div>
          <ul className="career-list">
            {of("application_target").map((e) => (
              <Row
                key={e.id}
                entry={e}
                act={act}
                onEdit={() => setEdit({ kind: "application_target", entry: e })}
                meta={[e.status, str(e.details.type)]
                  .filter(Boolean)
                  .join(" · ")}
                extra={
                  <button
                    className="td-link"
                    onClick={() =>
                      setEdit({
                        kind: "application",
                        entry: null,
                        preset: {
                          title: e.title.replace(/\s*\(target[^)]*\)\s*$/i, ""),
                          details: { employer_id: e.id, type: e.details.type },
                        },
                      })
                    }
                  >
                    Start an application <ArrowRight size={13} aria-hidden />
                  </button>
                }
              />
            ))}
          </ul>
        </div>
      )}

      {section === "skills" && (
        <div className="career-section">
          <div className="career-section-head">
            <h2>Skills</h2>
            {add("skill")}
          </div>
          <ul className="career-list">
            {of("skill").map((s) => {
              const ev = (
                Array.isArray(s.details.evidence) ? s.details.evidence : []
              ) as { date: string | null; text: string }[];
              return (
                <Row
                  key={s.id}
                  entry={s}
                  act={act}
                  onEdit={() => setEdit({ kind: "skill", entry: s })}
                  meta={[
                    s.status,
                    str(s.details.level) && `now ${str(s.details.level)}`,
                    str(s.details.target) && `target ${str(s.details.target)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  extra={
                    <>
                      {ev.slice(0, 2).map((x, i) => (
                        <span key={i} className="career-evidence">
                          {x.date ? `${friendlyDate(x.date)}: ` : ""}
                          {x.text}
                        </span>
                      ))}
                      <button
                        className="td-link"
                        onClick={() => setEvidence(s)}
                        aria-label={`Add evidence for ${s.title}`}
                      >
                        <Award size={13} aria-hidden /> Add evidence
                      </button>
                    </>
                  }
                />
              );
            })}
          </ul>
          <div className="career-section-head">
            <h2>Portfolio</h2>
            {add("portfolio_project")}
          </div>
          <ul className="career-list">
            {of("portfolio_project").map((p) => (
              <Row
                key={p.id}
                entry={p}
                act={act}
                onEdit={() => setEdit({ kind: "portfolio_project", entry: p })}
                meta={[
                  p.status,
                  p.due_date && `target ${friendlyDate(p.due_date)}`,
                  str(p.details.area),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                extra={
                  str(p.details.next_step) ? (
                    <span className="career-evidence">
                      Next: {str(p.details.next_step)}
                    </span>
                  ) : null
                }
              />
            ))}
          </ul>
        </div>
      )}

      {section === "plans" && (
        <div className="career-section">
          <div className="career-section-head">
            <h2>Semester plan</h2>
            {add("career_goal")}
          </div>
          {semesters.map((sem) => (
            <details
              key={sem}
              className="career-group"
              open={sem === "Fall 2026"}
            >
              <summary>
                {sem}{" "}
                <span className="career-meta">
                  {
                    of("career_goal").filter(
                      (g) => (str(g.details.semester) || "Other") === sem,
                    ).length
                  }
                </span>
              </summary>
              <ul className="career-list">
                {of("career_goal")
                  .filter((g) => (str(g.details.semester) || "Other") === sem)
                  .map((g) => (
                    <Row
                      key={g.id}
                      entry={g}
                      act={act}
                      onEdit={() => setEdit({ kind: "career_goal", entry: g })}
                      meta={[
                        str(g.details.area),
                        g.status,
                        g.due_date && friendlyDate(g.due_date),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      extra={
                        str(g.details.next_action) ? (
                          <span className="career-evidence">
                            Next: {str(g.details.next_action)}
                          </span>
                        ) : null
                      }
                    />
                  ))}
              </ul>
            </details>
          ))}
          <div className="career-section-head">
            <h2>Four-year roadmap</h2>
          </div>
          <ul className="career-list">
            {of("roadmap").map((y) => (
              <Row
                key={y.id}
                entry={y}
                act={act}
                onEdit={() => setEdit({ kind: "roadmap", entry: y })}
                meta={
                  str(y.details.success_test) &&
                  `Success test: ${str(y.details.success_test)}`
                }
              />
            ))}
          </ul>
          <div className="career-section-head">
            <h2>Internship &amp; co-op roadmap</h2>
          </div>
          <ul className="career-list">
            {of("coop_term").map((c) => (
              <Row
                key={c.id}
                entry={c}
                act={act}
                onEdit={() => setEdit({ kind: "coop_term", entry: c })}
                meta={[c.status, str(c.details.application_window)]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </ul>
        </div>
      )}

      {section === "reference" && <Reference entries={of("reference")} />}

      {edit && (
        <EntryEditor
          kind={edit.kind}
          entry={edit.entry}
          preset={edit.preset}
          act={act}
          onClose={() => setEdit(null)}
        />
      )}
      {person && (
        <ContactEditor
          contact={person === "new" ? null : person}
          act={act}
          onClose={() => setPerson(null)}
        />
      )}
      {log && (
        <LogConversation contact={log} act={act} onClose={() => setLog(null)} />
      )}
      {evidence && (
        <EvidenceEditor
          entry={evidence}
          act={act}
          onClose={() => setEvidence(null)}
        />
      )}
    </section>
  );
}

/** Guidance kept from the workbook, readable rather than editable. */
function Reference({ entries }: { entries: Entry[] }) {
  if (!entries.length)
    return <p className="course-empty">No reference notes yet.</p>;
  const rows = (v: unknown) =>
    Array.isArray(v) ? (v as Record<string, string>[]) : [];
  return (
    <div className="career-section career-reference">
      {entries.map((e) => (
        <details key={e.id} className="career-group">
          <summary>{e.title}</summary>
          {e.details.principle ? (
            <p className="career-principle">{str(e.details.principle)}</p>
          ) : null}
          {Object.entries(e.details)
            .filter(([k, v]) => Array.isArray(v) && !k.startsWith("_"))
            .map(([k, v]) => (
              <div key={k} className="career-ref-table">
                <h3>
                  {k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                </h3>
                <ul>
                  {rows(v).map((r, i) => (
                    <li key={i}>
                      {Object.entries(r)
                        .filter(([, x]) => x)
                        .map(([kk, x], j) => (
                          <span
                            key={kk}
                            className={j === 0 ? "career-ref-lead" : ""}
                          >
                            {j === 0 ? x : ` · ${x}`}
                          </span>
                        ))}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </details>
      ))}
      <p className="career-meta">
        <Check size={13} aria-hidden /> Kept from the Google Sheets career
        dashboard so it stays readable after the workbook is archived.
      </p>
    </div>
  );
}
