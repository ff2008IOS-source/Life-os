"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { contactKey, type FollowUp } from "@/lib/follow-ups";
import { dueLabel } from "@/lib/display";

type State = {
  connected: boolean;
  follow_ups: FollowUp[];
  deadlines: {
    row_id: string;
    title: string;
    status: string;
    deadline: string;
  }[];
  applications?: number;
};

const since = (f: FollowUp) =>
  f.days_since === null
    ? "No conversation logged"
    : f.days_since === 0
      ? "Talked today"
      : `Last talked ${f.days_since} day${f.days_since === 1 ? "" : "s"} ago`;

export function useFollowUps() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setState(await calendarRequest<State>("/api/v1/career/follow-ups"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Follow-ups couldn’t load.");
    }
  }, []);
  useEffect(() => {
    let live = true;
    calendarRequest<State>("/api/v1/career/follow-ups")
      .then((d) => live && setState(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  /** Logs a conversation today in Life OS; the sheet itself is untouched. */
  const talked = useCallback(
    async (f: FollowUp) => {
      const now = new Date().toISOString();
      if (f.record) {
        await calendarRequest(`/api/v1/contacts/${f.record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: f.record.version,
            data: {
              name: f.name,
              organization: f.organization || null,
              role: f.role || null,
              email: null,
              relationship_notes: "",
              source_id: null,
              source_key: contactKey(f.row_id),
              last_contact_at: now,
              next_follow_up_date: null,
            },
          }),
        });
      } else {
        await calendarRequest("/api/v1/contacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            name: f.name,
            organization: f.organization || null,
            role: f.role || null,
            source_key: contactKey(f.row_id),
            last_contact_at: now,
          }),
        });
      }
      await load();
    },
    [load],
  );
  return { state, error, talked };
}

/** Today: the one person most worth checking in with. */
export function FollowUpNudge() {
  const { state, talked } = useFollowUps();
  const [busy, setBusy] = useState(false);
  const next = state?.follow_ups.find((f) => f.due);
  const deadline = state?.deadlines[0];
  if (!next && !deadline) return null;
  return (
    <section className="td-card" aria-label="Career">
      <div className="td-card-head">
        <h2 className="td-card-title">Career</h2>
        <Link href="/growth" className="td-link">
          People <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      {deadline && (
        <div className="td-nudge">
          <div>
            <span className="td-nudge-kicker">APPLICATION DUE</span>
            <strong>{deadline.title}</strong>
            <span className="td-muted">
              {dueLabel({ due_date: deadline.deadline })}
            </span>
          </div>
          <Link href="/areas/career" className="td-btn td-btn-dark td-btn-sm">
            Open <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      )}
      {next && (
        <div className="td-nudge">
          <div>
            <span className="td-nudge-kicker">CHECK IN</span>
            <strong>{next.name}</strong>
            <span className="td-muted">
              {[next.role, since(next)].filter(Boolean).join(" · ")}
            </span>
          </div>
          <button
            className="td-btn td-btn-dark td-btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await talked(next);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check size={14} aria-hidden /> Talked today
          </button>
        </div>
      )}
    </section>
  );
}

/** Growth: everyone in the contacts sheet, who's due first. */
export function CareerFollowUps() {
  const { state, error, talked } = useFollowUps();
  const [busy, setBusy] = useState("");
  if (error) return <p className="course-empty">{error}</p>;
  if (!state) return null;
  if (!state.connected)
    return (
      <section className="td-card" aria-label="People">
        <h2 className="td-card-title">People</h2>
        <p className="course-empty">
          Connect your career spreadsheet in Settings → Connections to see who
          to check in with.
        </p>
      </section>
    );
  const due = state.follow_ups.filter((f) => f.due).length;
  return (
    <section className="td-card" aria-label="People">
      <div className="td-card-head">
        <h2 className="td-card-title">
          People{" "}
          <span className="course-count">
            {due ? `${due} to check in with` : "All caught up"}
          </span>
        </h2>
      </div>
      <ul className="topic-list">
        {state.follow_ups.map((f) => (
          <li key={f.row_id} className="person">
            <div>
              <strong>{f.name}</strong>
              <span>
                {[f.role, f.organization.split(/[;,]/)[0].trim()]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <span className="person-since">{since(f)}</span>
            <button
              className="td-link"
              disabled={!!busy || f.days_since === 0}
              onClick={async () => {
                setBusy(f.row_id);
                try {
                  await talked(f);
                } finally {
                  setBusy("");
                }
              }}
            >
              {busy === f.row_id ? "Saving…" : "Talked today"}
            </button>
          </li>
        ))}
      </ul>
      {state.deadlines.length > 0 ? (
        <>
          <h3 className="new-term-sub">Application deadlines</h3>
          <ul className="topic-list">
            {state.deadlines.map((d) => (
              <li key={d.row_id} className="person">
                <div>
                  <strong>{d.title}</strong>
                  <span>{d.status}</span>
                </div>
                <span className="person-since">
                  {dueLabel({ due_date: d.deadline })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : state.applications ? (
        <p className="course-note">
          Add a Deadline column to your Application pipeline sheet and the
          closest deadlines will show here and on Today.
        </p>
      ) : null}
    </section>
  );
}
