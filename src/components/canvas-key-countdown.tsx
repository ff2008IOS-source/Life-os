"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { CountdownRing } from "./living";

type Status = {
  connected: boolean;
  connection: { expires_at: string | null } | null;
};

const CANVAS_SETTINGS = "https://canvas.sfu.ca/profile/settings";
const LIFE_OS_CANVAS = "/settings?section=integrations&canvas=manage";

/**
 * How many days are left on the SFU Canvas key, and, folded away, exactly
 * how to renew it. SFU keys last at most a month.
 */
export function CanvasKeyCountdown() {
  const [state, setState] = useState<Status | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void fetch("/api/canvas/connection", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setState(d))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, []);
  const expires = state?.connection?.expires_at ?? null;
  const days = expires
    ? Math.ceil((Date.parse(expires) - now) / 86400000)
    : null;
  const tone =
    days === null
      ? ""
      : days <= 3
        ? "st-key-warn"
        : days <= 7
          ? "st-key-soon"
          : "";
  return (
    <section
      id="st-canvas-key"
      className={`panel settings-panel st-key ${tone}`}
      aria-label="SFU Canvas key"
    >
      <div className="st-key-head">
        {days !== null && <CountdownRing days={days} span={32} size={56} />}
        <div>
          <h2>
            {!state
              ? "SFU Canvas key"
              : !state.connected
                ? "SFU Canvas isn't connected"
                : days === null
                  ? "SFU Canvas key"
                  : days <= 0
                    ? "Your SFU Canvas key has expired"
                    : `Renew your SFU Canvas key in ${days} day${days === 1 ? "" : "s"}`}
          </h2>
          <p className="small muted">
            {expires
              ? `It stops working ${formatInTimeZone(expires, "America/Vancouver", "EEEE, MMMM d 'at' h:mm a")} (Vancouver). SFU keys last at most a month; renewing takes about two minutes.`
              : "Connect Canvas with a key so courses, grades and deadlines come in."}
          </p>
        </div>
      </div>
      <details className="st-key-steps">
        <summary className="text-link">How to renew it, step by step</summary>
        <ol>
          <li>
            Open{" "}
            <a href={CANVAS_SETTINGS} target="_blank" rel="noreferrer">
              your SFU Canvas settings
            </a>{" "}
            and sign in with your SFU computing ID if asked.
          </li>
          <li>
            Scroll to <strong>Approved Integrations</strong> and press{" "}
            <strong>+ New Access Token</strong>.
          </li>
          <li>
            For <strong>Purpose</strong> type <em>Life OS</em>. For{" "}
            <strong>Expiration date</strong> pick a date up to 30 days away,
            then press <strong>Generate Token</strong>.
          </li>
          <li>
            Copy the long token straight away; Canvas shows it only once. Note
            the expiry date and time it shows.
          </li>
          <li>
            Come back to{" "}
            <Link
              href={LIFE_OS_CANVAS}
              scroll={false}
              onClick={(e) => {
                // Pick the panel on screen (a hidden copy of the page can exist).
                const panel = [
                  ...document.querySelectorAll("#canvas-connection"),
                ].find((el) => (el as HTMLElement).offsetParent !== null);
                if (!(panel instanceof HTMLDetailsElement)) return;
                e.preventDefault();
                panel.open = true;
                panel.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Life OS → SFU Canvas → Manage connection
            </Link>
            . Paste the token into <strong>Canvas access token</strong>, enter
            the same expiry in <strong>Actual token expiry (Vancouver)</strong>{" "}
            and press <strong>Verify and save token</strong>.
          </li>
          <li>
            Press <strong>Sync now</strong>. Your courses, grades and deadlines
            stay as they were; nothing is lost while the key is renewed.
          </li>
          <li>
            Optional: back in{" "}
            <a href={CANVAS_SETTINGS} target="_blank" rel="noreferrer">
              Canvas settings
            </a>
            , delete the old Life OS token under Approved Integrations.
          </li>
        </ol>
      </details>
    </section>
  );
}
