"use client";
import { useCallback, useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { Button } from "./ui/button";

type State = {
  settings?: {
    enabled: boolean;
    free_plan_confirmed: boolean;
    daily_limit: number;
  } | null;
  configured: boolean;
  usage?: { requests: number } | null;
};

/**
 * Settings → Connections: the AI that sits down with you for the weekly
 * review. Reachable any day, not only inside an open review.
 */
export function AiReviewSettings() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      setState(await calendarRequest<State>("/api/v1/assistant"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't load AI settings.");
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);
  return (
    <section
      className="panel settings-panel"
      aria-label="AI for weekly reviews"
      id="ai-review"
    >
      <h2>AI for weekly reviews</h2>
      <p>
        Google Gemini sits down with you for the Sunday review: it knows your
        week, deadlines, grades, calendar and course files, answers questions
        and builds study plans.
      </p>
      <p className="small muted">
        {state === null
          ? "Checking…"
          : state.configured
            ? "Gemini connected."
            : "Gemini isn't connected yet: add GEMINI_API_KEY in Vercel, then redeploy."}
        {state?.usage ? ` · ${state.usage.requests} messages today.` : ""}
      </p>
      <form
        key={JSON.stringify(state?.settings ?? null)}
        className="academic-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            await calendarRequest("/api/v1/assistant", {
              method: "PATCH",
              body: JSON.stringify({
                enabled: f.has("enabled"),
                free_plan_confirmed: f.has("free"),
                daily_limit: Number(f.get("limit")),
              }),
            });
            await load();
            setMessage("Saved.");
          } catch (err) {
            setMessage(err instanceof Error ? err.message : "Couldn't save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="inline-check">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={state?.settings?.enabled ?? false}
          />
          Turn on AI for weekly reviews
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            name="free"
            defaultChecked={state?.settings?.free_plan_confirmed ?? false}
          />
          Use the free Gemini tier (Google may use these conversations to
          improve its products)
        </label>
        <label>
          Daily message allowance (1–100)
          <input
            type="number"
            name="limit"
            min={1}
            max={100}
            required
            defaultValue={state?.settings?.daily_limit ?? 60}
          />
        </label>
        <Button disabled={busy || state === null}>Save AI settings</Button>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
