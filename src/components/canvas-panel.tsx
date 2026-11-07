"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Button } from "./ui/button";
import type { canvasStatus } from "@/lib/canvas/service";
type Status = Awaited<ReturnType<typeof canvasStatus>>;
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error?.message ?? "Canvas request failed.");
  return d;
}
export function CanvasPanel() {
  const [state, setState] = useState<Status | null>(null),
    [token, setToken] = useState(""),
    [expiry, setExpiry] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const reload = async () =>
    setState(await call<Status>("/api/canvas/connection"));
  useEffect(() => {
    let live = true;
    void call<Status>("/api/canvas/connection")
      .then((d) => {
        if (live) setState(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function sync() {
    setBusy(true);
    setError("");
    try {
      let count = 0;
      for (let i = 0; i < 40; i++) {
        const d = await call<{
          processed: number;
          pending: number;
          errors: string[];
        }>("/api/canvas/sync" + (i === 0 ? "?refresh=true" : ""), {
          method: "POST",
        });
        count += d.processed;
        setMessage(
          `${count} resource records checked. ${d.pending} pages/jobs ready to continue.`,
        );
        if (d.errors.length) {
          setError(d.errors.join(" "));
        }
        if (!d.pending) break;
        if (i === 39)
          setMessage(
            "Progress saved. Select Sync now to continue remaining pages.",
          );
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      try {
        await reload();
      } catch {}
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel canvas-panel">
      <div className="academic-toolbar">
        <h1>SFU Canvas</h1>
        <Link className="text-link" href="/settings?section=integrations">
          Settings
        </Link>
      </div>
      <p className="muted small">
        Read-only academic synchronization. Canvas deadlines and grades stay
        separate from study effort and mastery.
      </p>
      <p role="status">
        {state
          ? state.connected
            ? state.connection?.enabled
              ? "Connected"
              : "Paused or authorization needs renewal"
            : "Not connected"
          : "Checking connection…"}
      </p>
      {state?.connection?.expires_at && (
        <p className="small">
          Token expires{" "}
          {formatInTimeZone(
            state.connection.expires_at,
            "America/Vancouver",
            "MMM d, yyyy h:mm a",
          )}{" "}
          Vancouver (owner supplied).
        </p>
      )}
      {state?.warning !== null && state?.warning !== undefined && (
        <p className="notice">
          {state.warning === 0
            ? "Token expired. Replace it to resume synchronization."
            : `Renew your Canvas token within ${state.warning} day(s).`}
        </p>
      )}
      <p className="form-hint">
        Last successful resource sync:{" "}
        {state?.connection?.last_sync_at
          ? formatInTimeZone(
              state.connection.last_sync_at,
              "America/Vancouver",
              "MMM d, h:mm a",
            )
          : "Not yet verified"}
        . {state?.stale ? "Data may be stale." : ""}
      </p>
      <form
        className="academic-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await call("/api/canvas/connection", {
              method: "POST",
              body: JSON.stringify({
                token,
                expires_at: fromZonedTime(
                  expiry,
                  "America/Vancouver",
                ).toISOString(),
              }),
            });
            setToken("");
            setMessage(
              "Canvas verified. Select Sync now to import authorized academic information.",
            );
            await reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Connection failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Canvas access token
          <input
            type="password"
            required
            autoComplete="off"
            maxLength={4096}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label>
          Actual token expiry (Vancouver)
          <input
            type="datetime-local"
            required
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>
        <p className="form-hint">
          Enter or replace your token here. It is encrypted on the server and
          never shown again. Replacement preserves imported records. Never enter
          it in chat.
        </p>
        <Button disabled={busy || !token || !expiry}>
          Verify and save token
        </Button>
      </form>
      <div className="career-import-actions">
        <Button
          disabled={
            busy ||
            !state?.connected ||
            !state.connection?.enabled ||
            state.warning === 0
          }
          onClick={() => void sync()}
        >
          {busy ? "Working…" : "Sync now"}
        </Button>
        {state?.connected && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await call("/api/canvas/connection", {
                  method: "PATCH",
                  body: JSON.stringify({ enabled: !state.connection?.enabled }),
                });
                await reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {state.connection?.enabled ? "Pause sync" : "Resume sync"}
          </Button>
        )}
        {state?.connected && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "Remove the stored Canvas token? Imported academic history will remain.",
                )
              )
                return;
              try {
                await call("/api/canvas/connection", { method: "DELETE" });
                await reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Remove connection
          </Button>
        )}
      </div>
      {state?.connection?.last_error && (
        <p role="alert" className="error-message">
          {state.connection.last_error}
        </p>
      )}
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!!state?.conflicts.length && (
        <details>
          <summary>
            Academic records needing review ({state.conflicts.length}
            {state.conflicts_truncated ? "+" : ""})
          </summary>
          {state.conflicts.map((c) => (
            <div className="small" key={c.resource_type + c.canvas_id}>
              {c.resource_type} {c.canvas_id}: {c.conflict}
              {["course", "assignment", "assignment_group"].includes(
                c.resource_type,
              ) && (
                <ConflictReview
                  type={c.resource_type}
                  id={c.canvas_id}
                  onSaved={reload}
                />
              )}
            </div>
          ))}
        </details>
      )}
      <details>
        <summary>Synchronization status by resource</summary>
        {state?.resources.map((j) => (
          <p className="small" key={j.job_key}>
            {j.resource_type}:{" "}
            {j.last_error ??
              (j.next_url
                ? "Import in progress"
                : j.last_success_at
                  ? `Last checked ${formatInTimeZone(j.last_success_at, "America/Vancouver", "MMM d, h:mm a")}`
                  : "Not imported yet")}
          </p>
        ))}
        {state?.resources_truncated && (
          <p>More resource statuses exist than this view can display.</p>
        )}
      </details>
      <Link className="text-link" href="/canvas-materials">
        Browse imported course material and deadlines
      </Link>
    </section>
  );
}

function ConflictReview({
  type,
  id,
  onSaved,
}: {
  type: string;
  id: string;
  onSaved: () => Promise<void>;
}) {
  const [details, setDetails] = useState<{
      incoming: Record<string, unknown>;
      source_hash: string;
      target: string | null;
      local: Record<string, unknown> | null;
      courses: { id: string; code: string; title: string }[];
    } | null>(null),
    [target, setTarget] = useState(""),
    [error, setError] = useState("");
  return (
    <span>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const d = await call<NonNullable<typeof details>>(
              `/api/canvas/reconcile?type=${type}&id=${id}`,
            );
            setDetails(d);
            setTarget(d.target ?? "");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Review values
      </Button>
      {details && (
        <span style={{ display: "block" }}>
          {Object.entries(details.incoming).map(([k, v]) => (
            <span
              key={k}
              style={{ display: "block", overflowWrap: "anywhere" }}
            >
              {k}: Canvas {String(v ?? "Unknown")}
              {details.local
                ? ` · Life OS ${String(details.local[k] ?? "Unknown")}`
                : ""}
            </span>
          ))}
          {type === "course" && (
            <label>
              Match existing course
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose a course</option>
                {details.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            size="sm"
            disabled={!target}
            onClick={async () => {
              if (
                !confirm(
                  "Use these Canvas fields? Existing notes, study progress and task completion will be preserved.",
                )
              )
                return;
              try {
                await call("/api/canvas/reconcile", {
                  method: "POST",
                  body: JSON.stringify({
                    type,
                    id,
                    target,
                    confirmed: true,
                    source_hash: details.source_hash,
                  }),
                });
                setDetails(null);
                await onSaved();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {type === "course" ? "Confirm course mapping" : "Use Canvas fields"}
          </Button>
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
