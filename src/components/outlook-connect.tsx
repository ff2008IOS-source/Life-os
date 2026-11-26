"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { dueLabel } from "@/lib/display";

type Status = {
  connected: boolean;
  client_id: string;
  tenant: string;
  account: string | null;
  done: boolean;
  imported: number;
  last_sync_at: string | null;
  last_error: string | null;
} | null;

const post = <T,>(body: unknown) =>
  calendarRequest<T>("/api/v1/outlook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Settings → Connections: reads SFU Outlook directly (read-only), including
 * all older mail. Keeps importing while this panel is open until the whole
 * mailbox is in.
 */
export function OutlookConnect() {
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [clientId, setClientId] = useState("");
  const [tenant, setTenant] = useState("sfu.ca");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const running = useRef(false);
  const load = useCallback(async () => {
    const r = await calendarRequest<{ outlook: Status }>("/api/v1/outlook");
    setStatus(r.outlook);
    if (r.outlook) {
      setClientId(r.outlook.client_id);
      setTenant(r.outlook.tenant);
    }
    return r.outlook;
  }, []);
  const importAll = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < 200; i++) {
        const r = await post<{ imported: number; done: boolean }>({
          action: "sync",
        });
        setStatus((s) => (s ? { ...s, ...r } : s));
        if (r.done) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outlook couldn't be read.");
    } finally {
      running.current = false;
      setBusy(false);
      await load().catch(() => {});
    }
  }, [load]);
  useEffect(() => {
    let live = true;
    calendarRequest<{ outlook: Status }>("/api/v1/outlook")
      .then((r) => {
        if (!live) return;
        setStatus(r.outlook);
        if (r.outlook) {
          setClientId(r.outlook.client_id);
          setTenant(r.outlook.tenant);
          // Pick up where the import stopped.
          if (r.outlook.connected && !r.outlook.done) void importAll();
        }
      })
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [importAll]);
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await post<{ url: string }>({
        action: "start",
        client_id: clientId.trim(),
        tenant: tenant.trim() || "sfu.ca",
      });
      window.location.assign(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start sign-in.");
      setBusy(false);
    }
  };
  const connected = status?.connected;
  return (
    <section className="panel settings-panel" aria-label="SFU Outlook">
      <h2 className="inline">
        <Inbox size={17} aria-hidden /> SFU Outlook
      </h2>
      <p>
        Life OS reads your SFU mailbox directly, read-only: every folder except
        Sent, Drafts, Deleted and Junk, including all older mail. Password-reset
        emails are never stored.
      </p>
      <p className="connection-summary">
        <span
          className={`connection-status ${connected ? (status?.last_error ? "warn" : "ok") : ""}`}
        >
          {connected
            ? status?.last_error
              ? "Action required"
              : "Connected"
            : "Not connected"}
        </span>
        {connected && (
          <span className="small muted">
            {status?.account ? `${status.account} · ` : ""}
            {status?.imported.toLocaleString()} emails
            {status?.done
              ? status.last_sync_at
                ? ` · checked ${dueLabel(status.last_sync_at)}`
                : ""
              : busy
                ? " · importing older mail…"
                : " · older mail still to import"}
          </span>
        )}
      </p>
      {status?.last_error && <p role="alert">{status.last_error}</p>}
      {connected ? (
        <div className="row-actions">
          <button
            className="td-btn td-btn-ghost td-btn-sm"
            disabled={busy}
            onClick={() => void importAll()}
          >
            <RefreshCw size={14} aria-hidden />{" "}
            {status?.done ? "Check for new mail" : "Continue importing"}
          </button>
          <button
            className="td-link td-link-muted"
            disabled={busy}
            onClick={async () => {
              await post({ action: "disconnect" });
              await load();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : !open && !status ? (
        <button
          className="td-btn td-btn-dark td-btn-sm"
          onClick={() => setOpen(true)}
        >
          Connect SFU Outlook
        </button>
      ) : (
        <ol className="email-steps">
          <li>
            Go to <strong>entra.microsoft.com</strong> and sign in with your SFU
            account → <em>App registrations</em> → <em>New registration</em>.
            Name it <strong>Life OS</strong>.
          </li>
          <li>
            Under <em>Redirect URI</em>, choose{" "}
            <strong>Public client/native (mobile &amp; desktop)</strong> and
            enter{" "}
            <code>
              {typeof window === "undefined" ? "" : window.location.origin}
              /api/v1/outlook/callback
            </code>
            . Press <em>Register</em>.
          </li>
          <li>
            Copy the <strong>Application (client) ID</strong> here:
            <div className="outlook-fields">
              <input
                aria-label="Application (client) ID"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <input
                aria-label="Directory (tenant)"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
              />
            </div>
            <span className="small muted">
              Leave the second box as sfu.ca unless the app was made outside SFU
              (then use its Directory (tenant) ID).
            </span>
          </li>
          <li>
            <button
              className="td-btn td-btn-dark td-btn-sm"
              disabled={busy || !clientId.trim()}
              onClick={() => void connect()}
            >
              Sign in with SFU
            </button>
          </li>
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
