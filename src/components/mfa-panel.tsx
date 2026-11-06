"use client";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
type State = {
  factors: { id: string; status: string; name: string }[];
  assurance: string;
};
export function MfaPanel({
  challenge = false,
  onVerified,
}: {
  challenge?: boolean;
  onVerified?: () => void;
}) {
  const [state, setState] = useState<State | null>(null),
    [enrollment, setEnrollment] = useState<{
      id: string;
      qr_code: string;
      secret: string;
    } | null>(null),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    setState(await calendarRequest<State>("/api/v1/auth/mfa"));
  }, []);
  useEffect(() => {
    let live = true;
    void calendarRequest<State>("/api/v1/auth/mfa")
      .then((value) => {
        if (live) setState(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const verified = state?.factors.filter((f) => f.status === "verified") ?? [];
  const factor = enrollment?.id ?? selected ?? verified[0]?.id;
  const factorId = factor || verified[0]?.id;
  async function act(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Authenticator request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const qr = enrollment?.qr_code.startsWith("data:")
    ? enrollment.qr_code
    : enrollment
      ? "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(enrollment.qr_code)
      : "";
  return (
    <section className="panel settings-panel">
      <h2 className="inline">
        <ShieldCheck size={17} />
        {challenge ? "Verify your authenticator" : "Authenticator security"}
      </h2>
      <p>
        {challenge
          ? "Enter the current six-digit code from your authenticator app."
          : "Optional TOTP protection. Once enabled, private records require both your password and an authenticator code."}
      </p>
      {!state && !error && (
        <p role="status" className="muted small">
          Checking security settings…
        </p>
      )}
      {!challenge && state && !verified.length && !enrollment && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              setEnrollment(
                await calendarRequest("/api/v1/auth/mfa", {
                  method: "POST",
                  body: JSON.stringify({ action: "enroll" }),
                }),
              );
            })
          }
        >
          Set up authenticator
        </Button>
      )}
      {enrollment && (
        <div className="mfa-enrollment">
          <Image
            src={qr}
            alt="Authenticator setup QR code"
            width={180}
            height={180}
            unoptimized
          />
          <p className="muted small">
            Scan this code with your authenticator, or enter the setup key
            below. Keep this key private.
          </p>
          <code className="mfa-secret">{enrollment.secret}</code>
        </div>
      )}
      {((challenge && verified.length > 0) || enrollment) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              if (!factorId) throw Error("Choose an authenticator.");
              await calendarRequest("/api/v1/auth/mfa", {
                method: "POST",
                body: JSON.stringify({
                  action: "verify",
                  factor_id: factorId,
                  code,
                }),
              });
              setCode("");
              setEnrollment(null);
              await load();
              onVerified?.();
            });
          }}
        >
          {!enrollment && verified.length > 1 && (
            <label>
              Authenticator
              <select
                value={factorId}
                onChange={(e) => setSelected(e.currentTarget.value)}
              >
                {verified.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Authenticator code
            <input
              value={code}
              onChange={(e) =>
                setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              maxLength={6}
            />
          </label>
          <Button disabled={busy || code.length !== 6} type="submit">
            {busy ? "Verifying…" : "Verify code"}
          </Button>
        </form>
      )}
      {!challenge && verified.length > 0 && (
        <div className="connection-feedback">
          Authenticator enabled.{" "}
          {state?.assurance === "aal2"
            ? "This session is verified."
            : "Verify your code to make security changes."}
        </div>
      )}
      {!challenge &&
        verified.map((f) => (
          <Button
            key={f.id}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Remove this authenticator? Your account will lose this factor.",
                )
              )
                void act(async () => {
                  await calendarRequest("/api/v1/auth/mfa", {
                    method: "POST",
                    body: JSON.stringify({ action: "remove", factor_id: f.id }),
                  });
                  await load();
                });
            }}
          >
            Remove {f.name}
          </Button>
        ))}
      {enrollment && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await calendarRequest("/api/v1/auth/mfa", {
                method: "POST",
                body: JSON.stringify({
                  action: "remove",
                  factor_id: enrollment.id,
                }),
              });
              setEnrollment(null);
            })
          }
        >
          Cancel setup
        </Button>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!challenge && (
        <p className="muted small academic-note">
          If you lose your authenticator, the Supabase project owner must verify
          your identity and remove the factor. No SMS service or paid MFA is
          enabled.
        </p>
      )}
    </section>
  );
}
