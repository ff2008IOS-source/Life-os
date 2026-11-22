"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
export type Session = {
  id: string;
  task_id: string;
  version: number;
  status: "running" | "paused" | "finished" | "discarded";
  elapsed_seconds: number;
  running_since: string | null;
};
type FocusContext = {
  session: Session | null;
  busy: boolean;
  canStart: boolean;
  start: (id: string) => Promise<void>;
  toggle: () => Promise<void>;
  finish: () => void;
  discard: () => Promise<void>;
};
const Context = createContext<FocusContext | null>(null);
export const useFocusSession = () => useContext(Context);
export function FocusSessionProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: { session: Session | null; server_time: string };
}) {
  const { data, refresh, notify } = useWorkspace();
  const [session, setSession] = useState<Session | null>(
      initial?.session ?? null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState(!!initial);
  const [finishing, setFinishing] = useState<Session | null>(null),
    [minutes, setMinutes] = useState(""),
    [finishTask, setFinishTask] = useState(false),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const startIntent = useRef<{ task: string; request: string } | null>(null);
  const lock = useRef(false);
  const dock = useRef<HTMLElement>(null);
  const focusAfterStart = useRef(false);
  const generation = useRef(0);
  async function reload() {
    const r = await calendarRequest<{
      session: Session | null;
      server_time: string;
    }>("/api/v1/focus");
    setSession(r.session);
    setLoaded(true);
    setOffset(Date.parse(r.server_time) - Date.now());
  }
  useEffect(() => {
    let live = true;
    const read = () => {
      if (document.visibilityState !== "visible" || lock.current) return;
      const revision = generation.current;
      void calendarRequest<{ session: Session | null; server_time: string }>(
        "/api/v1/focus",
      )
        .then((r) => {
          if (live && revision === generation.current) {
            setSession(r.session);
            setLoaded(true);
            setOffset(Date.parse(r.server_time) - Date.now());
          }
        })
        .catch(() => {
          if (live)
            setError(
              "Focus status could not refresh. Reload it before starting another session.",
            );
        });
    };
    if (!initial || Date.now() - Date.parse(initial.server_time) > 30000)
      read();
    const timer = setInterval(read, 30000);
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [initial]);
  async function action(
    action: string,
    target: Session | null,
    values: Record<string, unknown> = {},
  ) {
    if (lock.current) return;
    lock.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const r = await calendarRequest<{ session: Session }>("/api/v1/focus", {
        method: "POST",
        body: JSON.stringify({
          action,
          session_id: target?.id ?? null,
          version: target?.version ?? null,
          request_id: crypto.randomUUID(),
          ...values,
        }),
      });
      if (action === "start") focusAfterStart.current = true;
      setSession(
        ["running", "paused"].includes(r.session.status) ? r.session : null,
      );
      if (action === "finish") {
        setFinishing(null);
        try {
          await refresh();
        } catch {
          notify("Focus session saved · details refresh pending", undefined, {
            label: "Refresh saved work",
            action: refresh,
          });
        }
      }
      return r;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The session could not be updated. Reload its status before trying again.",
      );
      try {
        await reload();
      } catch {
        /* Keep the last known state, visibly marked stale. */
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start(id: string) {
    if (!startIntent.current || startIntent.current.task !== id)
      startIntent.current = { task: id, request: crypto.randomUUID() };
    const r = await action("start", null, {
      task_id: id,
      request_id: startIntent.current.request,
    });
    if (r) startIntent.current = null;
  }
  useEffect(() => {
    if (session?.id && focusAfterStart.current) {
      focusAfterStart.current = false;
      (
        document.querySelector<HTMLElement>("[data-current-focus]") ??
        dock.current
      )?.focus();
    }
  }, [session?.id]);
  const title =
    data.tasks.find((t) => t.id === session?.task_id)?.title ??
    "Your work session";
  function beginFinish() {
    if (!session) return;
    const elapsed = trackedSeconds(session, Date.now() + offset);
    setFinishing(session);
    setMinutes(
      elapsed >= 60 ? String(Math.min(1440, Math.floor(elapsed / 60))) : "",
    );
    setFinishTask(false);
    setNotes("");
    setConfirmed(false);
  }
  return (
    <Context.Provider
      value={{
        session,
        busy,
        canStart: loaded && !error && data.dashboard?.enabled !== false,
        start,
        toggle: async () => {
          if (session)
            await action(
              session.status === "running" ? "pause" : "resume",
              session,
            );
        },
        finish: beginFinish,
        discard: async () => {
          if (
            session &&
            window.confirm("Discard this timer without recording work?")
          )
            await action("discard", session);
        },
      }}
    >
      {children}
      {error && !finishing && (
        <div className="focus-error notice" role="alert">
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void reload()
                .then(() => setError(""))
                .catch(() =>
                  setError(
                    "Focus status is still unavailable. Try again shortly.",
                  ),
                )
            }
          >
            Reload focus status
          </Button>
        </div>
      )}
      {session && (
        <section
          className="focus-dock"
          aria-label="Current focus session"
          id="current-focus-session"
          ref={dock}
          tabIndex={-1}
        >
          <div>
            <strong>{title}</strong>
            <p>
              <FocusClock
                session={session}
                offset={offset}
                initialTime={initial?.server_time}
              />{" "}
              · {session.status === "running" ? "Focusing" : "Paused"}
            </p>
          </div>
          <div className="focus-dock-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(
                  session.status === "running" ? "pause" : "resume",
                  session,
                )
              }
            >
              {session.status === "running" ? "Pause focus" : "Resume focus"}
            </Button>
            <Button size="sm" disabled={busy} onClick={beginFinish}>
              Finish focus
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm("Discard this timer without recording work?")
                )
                  void action("discard", session);
              }}
            >
              Discard
            </Button>
          </div>
        </section>
      )}
      {finishing && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !busy) setFinishing(null);
          }}
          title="Record your focus session"
          description="Confirm the minutes you actually worked. Timer time is a guide; paused time is excluded."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmed)
                void action("finish", finishing, {
                  actual_minutes: Number(minutes),
                  finish_task: finishTask,
                  notes,
                });
            }}
            className="stack"
          >
            <label>
              Actual minutes worked
              <input
                type="number"
                required
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            <label>
              Session notes
              <textarea
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={finishTask}
                onChange={(e) => setFinishTask(e.target.checked)}
              />{" "}
              Also mark this task complete
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              These are the minutes I actually worked
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <Button type="submit" disabled={busy || !confirmed || !minutes}>
                Save focus session
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Context.Provider>
  );
}

function trackedSeconds(session: Session, now: number) {
  return (
    session.elapsed_seconds +
    (session.running_since
      ? Math.max(
          0,
          Math.floor((now - Date.parse(session.running_since)) / 1000),
        )
      : 0)
  );
}
function FocusClock({
  session,
  offset,
  initialTime,
}: {
  session: Session;
  offset: number;
  initialTime?: string;
}) {
  const [now, setNow] = useState(() =>
    initialTime ? Date.parse(initialTime) : Date.now(),
  );
  useEffect(() => {
    if (session.status !== "running") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [session.status]);
  const elapsed = trackedSeconds(session, now + offset);
  return (
    <span aria-label="Tracked time">
      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
    </span>
  );
}
