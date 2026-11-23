"use client";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { calendarRequest } from "./use-calendar";

/** Starts Google sign-in again; used wherever a sync failed for an expired grant. */
export function ReconnectGoogle({
  className = "td-btn td-btn-dark td-btn-sm",
  label = "Reconnect Google",
}: {
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { url } = await calendarRequest<{ url: string }>(
              "/api/v1/calendar/oauth/start",
              { method: "POST" },
            );
            window.location.assign(url);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Couldn’t start Google sign-in.",
            );
            setBusy(false);
          }
        }}
      >
        <Link2 size={14} aria-hidden /> {busy ? "Opening Google…" : label}
      </button>
      {error && (
        <span role="alert" className="td-alert">
          {error}
        </span>
      )}
    </>
  );
}

/** True when a calendar's saved error means Google needs a fresh sign-in. */
export function needsReconnect(errors: (string | null | undefined)[]) {
  return errors.some(
    (e) => !!e && /reconnect|authori[sz]ation expired/i.test(e),
  );
}
