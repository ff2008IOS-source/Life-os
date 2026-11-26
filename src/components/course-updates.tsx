"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Camera,
  Check,
  ListTodo,
  Undo2,
} from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { friendlyDate } from "@/lib/dates";
import type { UpdateAction } from "@/lib/update-actions";

/** Something only the owner can do (a Crowdmark mark, a grading change). */
export type Need = {
  id: string;
  course_id: string | null;
  title: string;
  posted_at: string;
  action: UpdateAction | null;
};
/** Something Life OS changed on its own from a course update or email. */
export type Change = {
  id: string;
  course_id: string | null;
  title: string;
  applied_at: string;
  applied:
    | {
        kind: "move_date";
        assessment: string;
        course_id: string;
        from_date: string | null;
        to: string;
      }
    | { kind: "add_task"; title: string; due_date: string };
};

const SYNC_KEY = "lifeos:v1:updates-synced";
const post = <T,>(body: unknown) =>
  calendarRequest<T>("/api/v1/updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

type Feed = { changes: Change[]; needs: Need[] };

/** Loads changes; pulls new Canvas announcements at most once an hour. */
export function useMailChanges() {
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
        if (live) setFeed({ changes: [], needs: [] });
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return { feed, reload: load };
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
  m: Need;
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

const cut = (t: string, n = 70) =>
  t.replace(/^\(\w+ \d{4}\)\s*/, "").length > n
    ? t
        .replace(/^\(\w+ \d{4}\)\s*/, "")
        .slice(0, n - 1)
        .trimEnd() + "…"
    : t.replace(/^\(\w+ \d{4}\)\s*/, "");

/**
 * Today: what Life OS changed from your course updates and SFU mail this
 * week (with Undo), and the few things it can't do alone. Hidden when
 * there's nothing.
 */
export function MailChangesCard({
  courseCode,
}: {
  courseCode: (id: string | null) => string | undefined;
}) {
  const { feed, reload } = useMailChanges();
  const [busy, setBusy] = useState(false);
  if (!feed || (!feed.changes.length && !feed.needs.length)) return null;
  const act = async (body: unknown) => {
    setBusy(true);
    try {
      await post(body);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="td-card" aria-label="Updated from your mail">
      <div className="td-card-head">
        <h2 className="td-card-title">Updated from your mail</h2>
        {feed.changes.length > 0 && (
          <button
            className="td-link td-link-muted"
            disabled={busy}
            onClick={() =>
              void act({
                action: "dismiss",
                ids: feed.changes.map((c) => c.id),
              })
            }
          >
            <Check size={14} aria-hidden /> Got it
          </button>
        )}
      </div>
      <ul className="change-list">
        {feed.changes.map((c) => {
          const a = c.applied;
          const code = courseCode(a.kind === "move_date" ? a.course_id : null);
          return (
            <li key={c.id} className="change">
              <span className="change-icon" aria-hidden>
                {a.kind === "move_date" ? (
                  <CalendarClock size={15} />
                ) : (
                  <ListTodo size={15} />
                )}
              </span>
              <span className="change-text">
                {a.kind === "move_date" ? (
                  <>
                    {code ? `${code} ` : ""}
                    <strong>{a.assessment}</strong> moved to{" "}
                    <strong>{friendlyDate(a.to)}</strong>
                    {a.from_date ? (
                      <span className="change-was">
                        {" "}
                        (was {friendlyDate(a.from_date)})
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    Task added: <strong>{cut(a.title, 60)}</strong>, due{" "}
                    {friendlyDate(a.due_date)}
                  </>
                )}
              </span>
              <button
                className="td-link td-link-muted"
                disabled={busy}
                aria-label={`Undo: ${a.kind === "move_date" ? a.assessment : a.title}`}
                onClick={() => void act({ action: "undo", message_id: c.id })}
              >
                <Undo2 size={14} aria-hidden /> Undo
              </button>
            </li>
          );
        })}
        {feed.needs.slice(0, 3).map((n) => (
          <li key={n.id} className="change change-need">
            <span className="change-icon" aria-hidden>
              <ArrowRight size={15} />
            </span>
            <div className="change-text">
              <span className="change-from">
                {[courseCode(n.course_id), cut(n.title)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <UpdateActionControl m={n} onDone={() => void reload()} />
            </div>
            <button
              className="td-link td-link-muted"
              disabled={busy}
              aria-label={`Dismiss ${n.title}`}
              onClick={() => void act({ action: "ack", ids: [n.id] })}
            >
              <Check size={14} aria-hidden /> Done
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
