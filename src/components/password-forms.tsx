"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
export function RecoveryRequest() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <main className="auth-utility">
      <section className="panel settings-panel">
        <h1>Recover your account</h1>
        <p className="muted small">
          Use your approved Life OS email. Recovery depends on the project’s
          email delivery settings.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            void calendarRequest<{ message: string }>("/api/v1/auth/recovery", {
              method: "POST",
              body: JSON.stringify({ email: f.get("email") }),
            })
              .then((r) => setMessage(r.message))
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <Button disabled={busy} type="submit">
            {busy ? "Requesting…" : "Send recovery link"}
          </Button>
        </form>
        {message && (
          <p role="status" className="connection-feedback">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <Link className="text-link" href="/login">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
export function PasswordForm({ recovery = false }: { recovery?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel settings-panel">
      <h2>{recovery ? "Set a new password" : "Change password"}</h2>
      <p className="muted small">
        Use at least 12 characters. A successful change signs out all sessions.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          void calendarRequest("/api/v1/auth/password", {
            method: "POST",
            body: JSON.stringify({
              password: f.get("password"),
              confirm: f.get("confirm"),
              ...(recovery
                ? {}
                : { current_password: f.get("current_password") }),
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
        {!recovery && (
          <label>
            Current password
            <input
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
        )}
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </section>
  );
}
