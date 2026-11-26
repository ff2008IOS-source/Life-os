"use client";
import { useEffect, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { gmailScript } from "@/lib/gmail-script";
import { dueLabel } from "@/lib/display";

type State = {
  email: { created_at: string; last_used_at: string | null } | null;
};

/**
 * Settings → Connections: lets course emails (forwarded from SFU Outlook to
 * Gmail) reach Life OS through a small script in the owner's Google account.
 */
export function CourseEmailSetup() {
  const [state, setState] = useState<State | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    calendarRequest<State>("/api/v1/updates")
      .then((d) => live && setState(d))
      .catch(() => live && setState({ email: null }));
    return () => {
      live = false;
    };
  }, []);
  const endpoint =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/internal/intake/email`;
  const script = token ? gmailScript(endpoint, token) : "";
  return (
    <section className="panel settings-panel" aria-label="Course email">
      <h2 className="inline">
        <Mail size={17} aria-hidden /> Course email
      </h2>
      <p>
        Announcements, schedule changes and “results are ready” emails from SFU,
        Canvas and Crowdmark show up in School and Today.
      </p>
      <p className="connection-summary">
        <span
          className={`connection-status ${state?.email?.last_used_at ? "ok" : state?.email ? "warn" : ""}`}
        >
          {state?.email?.last_used_at
            ? "Connected"
            : state?.email
              ? "Action required"
              : "Not connected"}
        </span>
        {state?.email?.last_used_at && (
          <span className="small muted">
            Last email {dueLabel(state.email.last_used_at)}
          </span>
        )}
      </p>
      {!token ? (
        <button
          className="td-btn td-btn-dark td-btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await calendarRequest<{ token: string }>(
                "/api/v1/updates",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "token" }),
                },
              );
              setToken(r.token);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Couldn’t create a link.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {state?.email
            ? "Make a new link (replaces the old one)"
            : "Set up course email"}
        </button>
      ) : (
        <ol className="email-steps">
          <li>
            In <strong>SFU Outlook</strong> (outlook.office.com) → Settings →
            Mail → Rules, add a rule: messages from <code>sfu.ca</code>,{" "}
            <code>instructure.com</code> or <code>crowdmark.com</code> →{" "}
            <em>Forward to</em> your Gmail address.
          </li>
          <li>
            Open <strong>script.google.com</strong> with that Gmail account →
            New project, and replace everything with the script below.
            <div className="email-script">
              <button
                className="td-btn td-btn-ghost td-btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(script);
                    setCopied(true);
                  } catch {}
                }}
              >
                <Copy size={14} aria-hidden />{" "}
                {copied ? "Copied" : "Copy script"}
              </button>
              <textarea
                readOnly
                value={script}
                rows={8}
                aria-label="Gmail script"
              />
            </div>
          </li>
          <li>
            Choose <strong>setUp</strong> in the function menu and press{" "}
            <strong>Run</strong>. Allow the Gmail and external-request
            permissions. It then checks every hour.
          </li>
          <li className="small muted">
            This link is shown once. It only lets that script add emails,
            nothing else.
          </li>
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
