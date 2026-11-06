"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
type Pending = {
  id: string;
  requested_at: string;
  execute_after: string;
  last_error: string | null;
  claimed_at: string | null;
};
export function AccountDeletion() {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void calendarRequest<{ pending: Pending | null }>(
      "/api/v1/account/deletion",
    )
      .then((r) => {
        if (live) setPending(r.pending);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="panel settings-panel">
      <h2>Delete account</h2>
      <p>
        Deletion is delayed seven days so you can cancel an accidental request.
        It removes Life OS records and revokes Google access; your Google
        calendars and spreadsheet stay intact.
      </p>
      {pending ? (
        <>
          <p className="error-message">
            Deletion scheduled after{" "}
            {new Date(pending.execute_after).toLocaleDateString("en-CA", {
              timeZone: "America/Vancouver",
            })}
            .
          </p>
          {pending.last_error && (
            <p role="alert" className="error-message">
              {pending.last_error}
            </p>
          )}
          <Button
            variant="outline"
            disabled={busy || !!pending.claimed_at}
            onClick={() => {
              setBusy(true);
              void calendarRequest("/api/v1/account/deletion", {
                method: "POST",
                body: JSON.stringify({ action: "cancel" }),
              })
                .then(() => setPending(null))
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {pending.claimed_at
              ? "Deletion is being finalized"
              : "Cancel deletion"}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            Review account deletion
          </Button>
          {expanded && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                void calendarRequest("/api/v1/account/deletion", {
                  method: "POST",
                  body: JSON.stringify({
                    action: "request",
                    password: f.get("password"),
                    confirmation: f.get("confirmation"),
                  }),
                })
                  .then(() => {
                    router.push("/login");
                    router.refresh();
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <p className="muted small">
                Export your records first. Full hosted restoration is still
                unverified. Requesting deletion signs out all sessions; sign in
                again within seven days to cancel.
              </p>
              <label>
                Current password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                Type DELETE to confirm
                <input
                  name="confirmation"
                  required
                  pattern="DELETE"
                  autoComplete="off"
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Requesting…" : "Schedule account deletion"}
              </Button>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
