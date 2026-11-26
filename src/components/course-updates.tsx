"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Mail,
  Megaphone,
  Search,
} from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { dueLabel } from "@/lib/display";
import { friendlyDate } from "@/lib/dates";
import type { UpdateAction } from "@/lib/update-actions";
import { GROUP_ORDER, mailGroup } from "@/lib/mail-groups";

export type CourseMessage = {
  id: string;
  course_id: string | null;
  source: "canvas_announcement" | "email";
  title: string;
  body: string;
  sender: string | null;
  url: string | null;
  posted_at: string;
  flags: string[];
  acknowledged_at: string | null;
  action: UpdateAction | null;
};

const FLAG_LABEL: Record<string, string> = {
  grading: "May change grading",
  schedule: "Date or time change",
  mark: "New mark posted",
};
const SYNC_KEY = "lifeos:v1:updates-synced";
const post = <T,>(body: unknown) =>
  calendarRequest<T>("/api/v1/updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

type Feed = { messages: CourseMessage[]; attention: CourseMessage[] };

/** Loads updates; pulls new Canvas announcements at most once an hour. */
export function useCourseUpdates() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const load = useCallback(async () => {
    setFeed(await calendarRequest<Feed>("/api/v1/updates"));
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let last = 0;
        try {
          last = Number(sessionStorage.getItem(SYNC_KEY) ?? 0);
        } catch {}
        if (Date.now() - last > 3600000) {
          try {
            sessionStorage.setItem(SYNC_KEY, String(Date.now()));
          } catch {}
          await post({ action: "sync" }).catch(() => {});
        }
        const r = await calendarRequest<Feed>("/api/v1/updates");
        if (live) setFeed(r);
      } catch {
        if (live) setFeed({ messages: [], attention: [] });
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const ack = useCallback(
    async (ids: string[]) => {
      await post({ action: "ack", ids });
      await load();
    },
    [load],
  );
  return {
    messages: feed?.messages ?? null,
    attention: feed?.attention ?? null,
    ack,
    reload: load,
  };
}

/** Screenshots are shrunk in the browser before they're read. */
async function shrink(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const shortDate = (d: string) => friendlyDate(d);

/** The one thing to do about an update, approved by the owner. */
export function UpdateActionControl({
  m,
  courseId,
  onDone,
}: {
  m: CourseMessage;
  courseId?: string | null;
  onDone: () => void;
}) {
  const a = m.action;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [earned, setEarned] = useState("");
  const [maximum, setMaximum] = useState(
    a?.kind === "enter_mark" && a.maximum ? String(a.maximum) : "100",
  );
  const [read, setRead] = useState("");
  const file = useRef<HTMLInputElement>(null);
  if (!a) return null;
  const run = async (body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await post(body);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const grades = `/areas/academics?course=${courseId ?? m.course_id}&view=grades`;
  if (a.kind === "mark_recorded")
    return (
      <p className="update-action update-action-done">
        <Check size={14} aria-hidden /> {a.assessment}: {a.percent}% recorded
      </p>
    );
  if (a.kind === "open_grades" || a.kind === "check_rules")
    return (
      <p className="update-action">
        <Link href={grades} className="td-link">
          {a.kind === "check_rules"
            ? "Check the grading rules"
            : "Enter the mark in Grades"}{" "}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </p>
    );
  if (a.kind === "move_date")
    return (
      <div className="update-action">
        <span>
          Move <strong>{a.assessment}</strong>
          {a.from ? ` from ${shortDate(a.from)}` : ""} to{" "}
          <strong>{shortDate(a.to)}</strong>?
        </span>
        <button
          className="td-btn td-btn-dark td-btn-sm"
          disabled={busy}
          onClick={() =>
            void run({
              action: "move_date",
              message_id: m.id,
              assessment_id: a.assessment_id,
              due_date: a.to,
            })
          }
        >
          Update date
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
    );
  if (a.kind === "add_task")
    return (
      <div className="update-action">
        <span>
          Add a task due <strong>{shortDate(a.due_date)}</strong>?
        </span>
        <button
          className="td-btn td-btn-ghost td-btn-sm"
          disabled={busy}
          onClick={() =>
            void run({
              action: "add_task",
              message_id: m.id,
              title: a.title,
              due_date: a.due_date,
            })
          }
        >
          Add task
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
    );
  // enter_mark: Crowdmark has no student API, so the mark is typed or read
  // from a screenshot, then confirmed.
  return (
    <form
      className="update-action update-mark"
      aria-label={`Enter your ${a.assessment} mark`}
      onSubmit={(e) => {
        e.preventDefault();
        void run({
          action: "record_mark",
          message_id: m.id,
          assessment_id: a.assessment_id,
          earned: Number(earned),
          maximum: Number(maximum),
        });
      }}
    >
      <span>
        Your <strong>{a.assessment}</strong> mark
      </span>
      <span className="update-mark-fields">
        <input
          inputMode="decimal"
          aria-label="Mark received"
          placeholder="53.5"
          value={earned}
          onChange={(e) => setEarned(e.target.value)}
        />
        <span aria-hidden>/</span>
        <input
          inputMode="decimal"
          aria-label="Out of"
          value={maximum}
          onChange={(e) => setMaximum(e.target.value)}
        />
      </span>
      <button
        className="td-btn td-btn-dark td-btn-sm"
        disabled={
          busy || !(Number(earned) >= 0 && earned !== "" && Number(maximum) > 0)
        }
      >
        Save
      </button>
      <button
        type="button"
        className="td-link td-link-muted"
        disabled={busy}
        onClick={() => file.current?.click()}
      >
        <Camera size={14} aria-hidden /> Read screenshot
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        aria-label="Screenshot of your mark"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setError("");
          setRead("");
          try {
            const r = await post<{
              found: boolean;
              earned?: number;
              maximum?: number | null;
            }>({
              action: "read_mark",
              image: await shrink(f),
              assessment: a.assessment,
            });
            if (!r.found || r.earned === undefined)
              setError("No total found in that screenshot. Type it instead.");
            else {
              setEarned(String(r.earned));
              if (r.maximum) setMaximum(String(r.maximum));
              setRead("Read from your screenshot. Check it, then Save.");
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't read it.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {read && <span className="small muted">{read}</span>}
      {error && <span role="alert">{error}</span>}
    </form>
  );
}

function Item({
  m,
  onAck,
  onDone,
  course,
  action = true,
}: {
  m: CourseMessage;
  onAck: () => void;
  onDone: () => void;
  course?: string;
  action?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`update ${m.acknowledged_at ? "update-seen" : ""}`}>
      <span className="update-icon" aria-hidden>
        {m.source === "email" ? <Mail size={15} /> : <Megaphone size={15} />}
      </span>
      <div className="update-main">
        <button
          className="update-title"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {m.title}
        </button>
        <span className="update-meta">
          {[
            course,
            m.source === "email"
              ? m.sender?.replace(/\s*<.*>/, "").replace(/"/g, "")
              : "Canvas",
            dueLabel(m.posted_at),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {m.flags.length > 0 && (
          <span className="update-flags">
            {m.flags.map((f) => (
              <span key={f} className={`update-flag update-flag-${f}`}>
                {FLAG_LABEL[f] ?? f}
              </span>
            ))}
          </span>
        )}
        {action && !m.acknowledged_at && (
          <UpdateActionControl m={m} onDone={onDone} />
        )}
        {open && (
          <p className="update-body">
            {m.body.slice(0, 1200)}
            {m.body.length > 1200 ? "…" : ""}
            {m.url && (
              <>
                {" "}
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="td-link"
                >
                  {m.source === "email" ? "Open in Outlook" : "Open in Canvas"}
                </a>
              </>
            )}
          </p>
        )}
      </div>
      {!m.acknowledged_at && (
        <button
          className="td-link td-link-muted"
          onClick={onAck}
          aria-label={`Mark ${m.title} as seen`}
        >
          <Check size={14} aria-hidden /> Seen
        </button>
      )}
    </li>
  );
}

const matches = (m: CourseMessage, q: string) =>
  !q ||
  `${m.title}\n${m.sender ?? ""}\n${m.body}`
    .toLowerCase()
    .includes(q.toLowerCase());

/**
 * School course Overview: what still needs attention pinned on top, then
 * recent updates, with search once there are more than a handful.
 */
export function CourseUpdatesSection({ courseId }: { courseId: string }) {
  const { messages, ack, reload } = useCourseUpdates();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const mine = (messages ?? []).filter((m) => m.course_id === courseId);
  if (!messages || !mine.length) return null;
  const attention = mine.filter(
    (m) =>
      !m.acknowledged_at &&
      m.action &&
      m.action.kind !== "mark_recorded" &&
      matches(m, q),
  );
  const rest = mine.filter((m) => !attention.includes(m) && matches(m, q));
  const shown = all || q ? rest : rest.slice(0, 4);
  return (
    <section className="course-section" aria-label="Course updates">
      <div className="course-section-head">
        <h3>Updates</h3>
        {mine.length > 5 && (
          <label className="update-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              placeholder="Search this course's updates"
              aria-label="Search this course's updates"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        )}
      </div>
      {attention.length > 0 && (
        <>
          <p className="update-group-label">Needs your attention</p>
          <ul className="update-list update-list-attention">
            {attention.map((m) => (
              <Item
                key={m.id}
                m={m}
                onAck={() => void ack([m.id])}
                onDone={() => void reload()}
              />
            ))}
          </ul>
        </>
      )}
      {shown.length > 0 && (
        <>
          {attention.length > 0 && <p className="update-group-label">Recent</p>}
          <ul className="update-list">
            {shown.map((m) => (
              <Item
                key={m.id}
                m={m}
                action={false}
                onAck={() => void ack([m.id])}
                onDone={() => void reload()}
              />
            ))}
          </ul>
        </>
      )}
      {!q && !all && rest.length > shown.length && (
        <button className="td-link" onClick={() => setAll(true)}>
          Show all {rest.length}
        </button>
      )}
      {q && !attention.length && !shown.length && (
        <p className="td-muted">Nothing matches “{q}”.</p>
      )}
    </section>
  );
}

/**
 * Today: what changed this week. Up to 3 unseen updates that need
 * something, each with its one action. Hidden when there's nothing new.
 */
export function WhatChangedCard({
  courseCode,
}: {
  courseCode: (id: string | null) => string | undefined;
}) {
  const { attention, ack, reload } = useCourseUpdates();
  if (!attention?.length) return null;
  const top = attention.slice(0, 3);
  return (
    <section className="td-card" aria-label="What changed">
      <div className="td-card-head">
        <h2 className="td-card-title">What changed</h2>
        {attention.length > top.length && (
          <span className="td-muted small">{attention.length} this week</span>
        )}
      </div>
      <ul className="update-list">
        {top.map((m) => (
          <Item
            key={m.id}
            m={m}
            course={courseCode(m.course_id)}
            onAck={() => void ack([m.id])}
            onDone={() => void reload()}
          />
        ))}
      </ul>
    </section>
  );
}

/** Week → Inbox: SFU mail that isn't about a course, people first. */
export function EmailList() {
  const [messages, setMessages] = useState<CourseMessage[] | null>(null);
  const [q, setQ] = useState("");
  // Groups with new mail start open; a tap overrides that.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    try {
      const r = await calendarRequest<{ messages: CourseMessage[] }>(
        "/api/v1/updates?scope=email",
      );
      setMessages(r.messages);
    } catch {
      setMessages([]);
    }
  }, []);
  useEffect(() => {
    let live = true;
    calendarRequest<{ messages: CourseMessage[] }>(
      "/api/v1/updates?scope=email",
    )
      .then((r) => live && setMessages(r.messages))
      .catch(() => live && setMessages([]));
    return () => {
      live = false;
    };
  }, []);
  const groups = useMemo(() => {
    const by = new Map<string, CourseMessage[]>();
    for (const m of messages ?? []) {
      if (!matches(m, q)) continue;
      const g = mailGroup(m);
      by.set(g, [...(by.get(g) ?? []), m]);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({
      name: g,
      items: by.get(g)!,
      unseen: by.get(g)!.filter((m) => !m.acknowledged_at).length,
    }));
  }, [messages, q]);
  if (!messages?.length) return null;
  const ack = async (ids: string[]) => {
    await post({ action: "ack", ids });
    await load();
  };
  const unseen = messages.filter((m) => !m.acknowledged_at);
  return (
    <section className="panel" aria-label="SFU mail">
      <div className="panel-heading">
        <div className="panel-title">
          <Mail aria-hidden />
          <h2>SFU mail</h2>
          {unseen.length > 0 && (
            <span className="small muted">{unseen.length} new</span>
          )}
        </div>
        {unseen.length > 1 && (
          <button
            className="td-link td-link-muted"
            onClick={() => void ack(unseen.slice(0, 100).map((m) => m.id))}
          >
            <Check size={14} aria-hidden /> Mark all seen
          </button>
        )}
      </div>
      <label className="update-search update-search-wide">
        <Search size={14} aria-hidden />
        <input
          type="search"
          placeholder="Search SFU mail"
          aria-label="Search SFU mail"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {groups.map((g) => {
        const expanded =
          !!q || (toggled[g.name] ?? (g.name === "People" || g.unseen > 0));
        return (
          <div key={g.name} className="mail-group">
            <button
              className="mail-group-head"
              aria-expanded={expanded}
              onClick={() => setToggled((t) => ({ ...t, [g.name]: !expanded }))}
            >
              <ChevronDown
                size={15}
                aria-hidden
                className={expanded ? "" : "mail-group-closed"}
              />
              <span>{g.name}</span>
              <span className="mail-group-count">
                {g.items.length}
                {g.unseen ? ` · ${g.unseen} new` : ""}
              </span>
            </button>
            {expanded && (
              <ul className="update-list">
                {g.items.slice(0, q ? 50 : 20).map((m) => (
                  <Item
                    key={m.id}
                    m={m}
                    onAck={() => void ack([m.id])}
                    onDone={() => void load()}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {q && !groups.length && (
        <p className="td-muted">Nothing matches “{q}”.</p>
      )}
    </section>
  );
}
