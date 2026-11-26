"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ArrowRight, Mail, Megaphone } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { dueLabel } from "@/lib/display";

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
};

const FLAG_LABEL: Record<string, string> = {
  grading: "May change grading",
  schedule: "Date or time change",
  mark: "New mark posted",
};
const SYNC_KEY = "lifeos:v1:updates-synced";

/** Loads updates; pulls new Canvas announcements at most once an hour. */
export function useCourseUpdates() {
  const [messages, setMessages] = useState<CourseMessage[] | null>(null);
  const load = useCallback(async () => {
    const r = await calendarRequest<{ messages: CourseMessage[] }>(
      "/api/v1/updates",
    );
    setMessages(r.messages);
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
          await calendarRequest("/api/v1/updates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync" }),
          }).catch(() => {});
        }
        const r = await calendarRequest<{ messages: CourseMessage[] }>(
          "/api/v1/updates",
        );
        if (live) setMessages(r.messages);
      } catch {
        if (live) setMessages([]);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const ack = useCallback(
    async (ids: string[]) => {
      await calendarRequest("/api/v1/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ack", ids }),
      });
      await load();
    },
    [load],
  );
  return { messages, ack };
}

function Item({
  m,
  onAck,
  course,
}: {
  m: CourseMessage;
  onAck: () => void;
  course?: string;
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
            m.source === "email" ? m.sender : "Canvas",
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
                  Open in Canvas
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

/** School course Overview: this course's recent announcements and emails. */
export function CourseUpdatesSection({ courseId }: { courseId: string }) {
  const { messages, ack } = useCourseUpdates();
  const mine = (messages ?? [])
    .filter((m) => m.course_id === courseId)
    .slice(0, 5);
  if (!messages || !mine.length) return null;
  const changes = mine.filter(
    (m) => m.flags.some((f) => f !== "mark") && !m.acknowledged_at,
  );
  return (
    <section className="course-section" aria-label="Course updates">
      <div className="course-section-head">
        <h3>
          Updates{" "}
          {changes.length > 0 && (
            <span className="course-count">
              {changes.length} may change grading or dates. Check the rules
              under Grades
            </span>
          )}
        </h3>
      </div>
      <ul className="update-list">
        {mine.map((m) => (
          <Item key={m.id} m={m} onAck={() => void ack([m.id])} />
        ))}
      </ul>
    </section>
  );
}

/** Today: unseen updates that may change grading, dates or marks. */
export function CourseUpdatesCard({
  courseCode,
}: {
  courseCode: (id: string | null) => string | undefined;
}) {
  const { messages, ack } = useCourseUpdates();
  const flagged = (messages ?? [])
    .filter((m) => m.flags.length && !m.acknowledged_at)
    .slice(0, 4);
  if (!flagged.length) return null;
  return (
    <section className="td-card" aria-label="Course updates">
      <div className="td-card-head">
        <h2 className="td-card-title">Course updates</h2>
        <Link href="/areas/academics" className="td-link">
          School <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <ul className="update-list">
        {flagged.map((m) => (
          <Item
            key={m.id}
            m={m}
            course={courseCode(m.course_id)}
            onAck={() => void ack([m.id])}
          />
        ))}
      </ul>
    </section>
  );
}
