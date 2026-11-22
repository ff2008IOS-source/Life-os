"use client";
import Link from "next/link";
import { AppLogo } from "./profile-identity";
import { MfaPanel } from "./mfa-panel";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
export function Login({
  configured,
  reason,
}: {
  configured: boolean;
  reason?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState(reason || "");
  const [mfa, setMfa] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error.message);
      if (body.mfa_required) {
        setMfa(true);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-form">
        <div className="login-form-inner">
          <Link className="brand" href="/">
            <span className="logo">
              <AppLogo />
            </span>
            Life OS
          </Link>
          <h2>
            {configured ? "Welcome to your space" : "Your space starts here"}
          </h2>

          {mfa ? (
            <MfaPanel
              challenge
              onVerified={() => {
                router.push("/");
                router.refresh();
              }}
            />
          ) : configured ? (
            <form onSubmit={submit}>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                />
              </label>
              <Button disabled={pending} className="full-width">
                {pending ? "Signing in…" : "Sign in"}
                <ArrowRight size={16} />
              </Button>
            </form>
          ) : (
            <div className="setup-steps">
              <div>
                <span>1</span>
                <p>
                  <strong>Connect Supabase Free</strong>
                  <small>
                    Add the project URL and publishable key to your local
                    environment.
                  </small>
                </p>
              </div>
              <div>
                <span>2</span>
                <p>
                  <strong>Provision your private account</strong>
                  <small>
                    Apply migrations, disable public signup, and approve your
                    user ID.
                  </small>
                </p>
              </div>
              <div>
                <span>3</span>
                <p>
                  <strong>Start with test data</strong>
                  <small>
                    Sign in, initialize your workspace, then create clearly
                    labeled beta records.
                  </small>
                </p>
              </div>
              <p className="small muted">
                Setup instructions: <code>README.md</code> in the project.
              </p>
            </div>
          )}
          {configured && !mfa && (
            <Link className="text-link" href="/forgot-password">
              Forgot your password?
            </Link>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <span>
              Private by design. Only your approved account has access.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
