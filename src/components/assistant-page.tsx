"use client";
import { useState, useEffect, useRef } from "react";
import { Send, Plus, Settings2, History, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import type { AssistantReply, AssistantSource } from "@/lib/assistant/provider";
type Conversation = {
  id: string;
  title: string;
  course_canvas_id: string | null;
};
type State = {
  configured: boolean;
  settings: {
    enabled: boolean;
    free_plan_confirmed: boolean;
    daily_limit: number;
  } | null;
  conversations: Conversation[];
  usage: { requests: number } | null;
};
type Exchange = {
  id: string;
  question: string;
  status: string;
  response: AssistantReply | null;
  sources: AssistantSource[];
  error: string | null;
};
export function AssistantPage() {
  const [state, setState] = useState<State | null>(null),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [question, setQuestion] = useState(""),
    [exchanges, setExchanges] = useState<Exchange[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState("");
  const settingsRef = useRef<HTMLDetailsElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  const intent = useRef<{
    id: string;
    question: string;
    conversation: string | null;
    course: string | null;
  } | null>(null);
  const reload = async () =>
    setState(await calendarRequest<State>("/api/v1/assistant"));
  async function history(id: string) {
    setExchanges(
      (
        await calendarRequest<{ exchanges: Exchange[] }>(
          `/api/v1/assistant?conversation=${id}`,
        )
      ).exchanges,
    );
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const d = await calendarRequest<State>("/api/v1/assistant");
        if (!active) return;
        setState(d);
        const c = d.conversations[0];
        if (c) {
          const h = await calendarRequest<{ exchanges: Exchange[] }>(
            `/api/v1/assistant?conversation=${c.id}`,
          );
          if (active) {
            setConversation(c);
            setExchanges(h.exchanges);
          }
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (exchanges.length || sending)
      bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [exchanges, sending]);
  async function send() {
    if (
      busy ||
      !question.trim() ||
      !state?.configured ||
      !state.settings?.enabled
    )
      return;
    setBusy(true);
    setSending(question);
    setError("");
    const courseId = conversation?.course_canvas_id ?? null;
    if (
      !intent.current ||
      intent.current.question !== question ||
      intent.current.conversation !== (conversation?.id ?? null)
    )
      intent.current = {
        id: crypto.randomUUID(),
        question,
        conversation: conversation?.id ?? null,
        course: courseId,
      };
    try {
      const d = await calendarRequest<{
        conversation_id: string;
        status: string;
      }>("/api/v1/assistant", {
        method: "POST",
        body: JSON.stringify({
          request_id: intent.current.id,
          conversation_id: conversation?.id ?? null,
          course_canvas_id: courseId,
          question,
        }),
      });
      if (d.status === "completed") {
        intent.current = null;
        setQuestion("");
      }
      await reload();
      setConversation({
        id: d.conversation_id,
        title: question.slice(0, 100),
        course_canvas_id: courseId,
      });
      await history(d.conversation_id);
    } catch (e) {
      setError((e as Error).message);
      await reload().catch(() => {});
      if (conversation) await history(conversation.id).catch(() => {});
    } finally {
      setBusy(false);
      setSending("");
    }
  }
  return (
    <section className="assistant-chat" aria-label="Assistant conversation">
      <div className="assistant-header">
        <div>
          <h1>Life OS assistant</h1>
          <p>Your work, courses and goals — connected.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setConversation(null);
            setExchanges([]);
            setQuestion("");
            setError("");
            intent.current = null;
          }}
        >
          <Plus size={16} />
          New chat
        </Button>
      </div>
      <div className="assistant-tools">
        <details>
          <summary>
            <History size={16} />
            History
          </summary>
          <div className="assistant-tool-body">
            <label>
              Saved conversations
              <select
                disabled={busy}
                value={conversation?.id ?? ""}
                onChange={async (e) => {
                  const c =
                    state?.conversations.find((c) => c.id === e.target.value) ??
                    null;
                  setConversation(c);
                  setError("");
                  try {
                    if (c) await history(c.id);
                    else setExchanges([]);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <option value="">New conversation</option>
                {state?.conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {conversation && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (
                    !confirm(
                      "Delete this conversation? Daily usage counters remain.",
                    )
                  )
                    return;
                  try {
                    await calendarRequest("/api/v1/assistant", {
                      method: "DELETE",
                      body: JSON.stringify({ id: conversation.id }),
                    });
                    setConversation(null);
                    setExchanges([]);
                    intent.current = null;
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Delete conversation
              </Button>
            )}
            <p className="form-hint">
              Latest 30 conversations shown. Retained history is available in
              your data export.
            </p>
          </div>
        </details>
        <details ref={settingsRef}>
          <summary>
            <Settings2 size={16} />
            Settings
          </summary>
          <div className="assistant-tool-body">
            <form
              key={JSON.stringify(state?.settings)}
              className="academic-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  await calendarRequest("/api/v1/assistant", {
                    method: "PATCH",
                    body: JSON.stringify({
                      enabled: f.has("enabled"),
                      free_plan_confirmed: f.has("free"),
                      daily_limit: Number(f.get("limit")),
                    }),
                  });
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
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
                Enable the assistant
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  name="free"
                  defaultChecked={state?.settings?.free_plan_confirmed ?? false}
                />
                I confirm this Groq account remains on the Free plan
              </label>
              <label>
                Daily request allowance (1–20)
                <input
                  type="number"
                  name="limit"
                  min={1}
                  max={20}
                  required
                  defaultValue={state?.settings?.daily_limit ?? 10}
                />
              </label>
              <p className="form-hint">
                Relevant task/goal/project facts, assessments across your
                courses, course excerpts and recent conversation context are
                sent to Groq. Canvas credentials are never included.
                Conversations stay in Life OS and can be deleted below or
                exported in Privacy settings. One request per minute, no
                automatic provider retries or paid fallback. Keep provider
                data-retention controls configured in your Groq account.
              </p>
              <Button disabled={busy || !state}>Save AI settings</Button>
            </form>
            <p className="form-hint">
              {state?.configured
                ? "Groq connected"
                : "Groq is not configured for this deployment"}{" "}
              · {state?.usage?.requests ?? 0} requests used today.
            </p>
          </div>
        </details>
      </div>
      {state && (!state.settings?.enabled || !state.configured) && (
        <div className="assistant-notice" role="status">
          {!state.configured
            ? "The AI connection is unavailable on this deployment."
            : "Turn on the assistant to start chatting."}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (settingsRef.current) settingsRef.current.open = true;
            }}
          >
            Open AI settings
          </Button>
        </div>
      )}
      <div
        className="assistant-messages"
        aria-label="Messages"
        aria-busy={busy}
      >
        {!exchanges.length && !sending && (
          <div className="assistant-welcome">
            <h2>What’s on your mind?</h2>
            <p>
              Ask naturally. I’ll look across your saved courses and work for
              relevant information.
            </p>
            <div className="assistant-prompts">
              {["What’s on my next exam?", "What should I focus on today?"].map(
                (prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setQuestion(prompt)}
                  >
                    {prompt}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {exchanges.map((x) => (
          <div className="assistant-exchange" key={x.id}>
            <article
              className="chat-message chat-user"
              aria-label="Your message"
            >
              <p>{x.question}</p>
            </article>
            <article
              className="chat-message chat-assistant"
              aria-label="Assistant reply"
            >
              {x.response ? (
                <>
                  <p>{x.response.answer}</p>
                  {(x.response.source_ids.length > 0 ||
                    x.response.unknowns.length > 0 ||
                    x.response.next_actions.length > 0) && (
                    <details className="chat-evidence">
                      <summary>Sources & details</summary>
                      {x.response.unknowns.length > 0 && (
                        <p className="form-hint">
                          Not confirmed: {x.response.unknowns.join(" · ")}
                        </p>
                      )}
                      {x.response.next_actions.length > 0 && (
                        <p className="form-hint">
                          Suggested next steps:{" "}
                          {x.response.next_actions.join(" · ")}
                        </p>
                      )}
                      {x.sources
                        .filter((s) => x.response!.source_ids.includes(s.id))
                        .map((s) => (
                          <p key={s.id} className="small">
                            <a className="text-link" href={s.url}>
                              {s.title}
                            </a>
                            {s.retrieved_at
                              ? ` · Synced ${new Date(s.retrieved_at).toLocaleString()}`
                              : ""}
                          </p>
                        ))}
                    </details>
                  )}
                </>
              ) : (
                <p className="muted">
                  {x.error ??
                    "No confirmed answer yet. Reopen this conversation before trying again."}
                </p>
              )}
            </article>
          </div>
        ))}
        {sending && (
          <div className="assistant-exchange">
            <article
              className="chat-message chat-user"
              aria-label="Your message"
            >
              <p>{sending}</p>
            </article>
            <p className="assistant-thinking" role="status">
              <LoaderCircle size={16} className="assistant-spinner" />
              Looking through your records…
            </p>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="assistant-question">
          Your question
        </label>
        <textarea
          id="assistant-question"
          rows={2}
          maxLength={1500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Message Life OS…"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="submit"
          aria-label="Ask assistant"
          disabled={
            busy ||
            !state?.configured ||
            !state.settings?.enabled ||
            !question.trim()
          }
        >
          <Send size={18} />
          <span className="sr-only">Send message</span>
        </Button>
      </form>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <p className="assistant-footnote">
        Uses relevant saved records across your courses. AI can make mistakes;
        check important details.
      </p>
    </section>
  );
}
