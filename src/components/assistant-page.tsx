"use client";
import { useState, useEffect, useRef } from "react";
import { Send, Plus, Settings2, History, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { formatInTimeZone } from "date-fns-tz";
import { Modal } from "./dialog";
import { limitMessage, type AssistantLimits } from "@/lib/assistant/limits";
import { calendarRequest } from "./use-calendar";
import type { AssistantReply, AssistantSource } from "@/lib/assistant/provider";
type Conversation = {
  id: string;
  title: string;
  course_canvas_id: string | null;
};
type State = {
  limits?: AssistantLimits;
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
  const [settingsOpen, setSettingsOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [now, setNow] = useState(Date.now());
  const messages = useRef<HTMLDivElement>(null),
    chat = useRef<HTMLElement>(null);
  useEffect(() => {
    const fit = () => {
      const root = chat.current;
      if (!root) return;
      const viewport = window.visualViewport;
      const bottom =
        (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0);
      const nav = document
        .querySelector(".mobile-nav")
        ?.getBoundingClientRect();
      const inset =
        nav && nav.height && nav.top < bottom ? bottom - nav.top : 0;
      const available = Math.max(
        160,
        bottom - root.getBoundingClientRect().top - inset - 16,
      );
      root.style.height = available + "px";
      root.style.minHeight = "0";
      root.dataset.compact = String(available < 300);
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, []);
  const retryAt = state?.limits?.retry_at
    ? Date.parse(state.limits.retry_at)
    : 0;
  const waiting =
    !!state?.limits?.reason &&
    state.limits.reason !== "disabled" &&
    (!retryAt || retryAt > now);
  useEffect(() => {
    if (!state?.limits?.reason || !retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setTimeout(
      () => {
        void calendarRequest<State>("/api/v1/assistant")
          .then(setState)
          .catch(() => {});
      },
      Math.max(1000, retryAt - Date.now() + 100),
    );
    return () => {
      clearInterval(timer);
      clearTimeout(refresh);
    };
  }, [state?.limits?.reason, retryAt]);
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
      messages.current?.scrollTo({
        top: messages.current.scrollHeight,
        behavior: "smooth",
      });
  }, [exchanges, sending]);
  async function send() {
    if (
      busy ||
      waiting ||
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
      const d = await assistantSend<{
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
        setQuestion((current) => (current === question ? "" : current));
      }
      if (d.status === "failed") intent.current = null;
      await reload();
      setConversation({
        id: d.conversation_id,
        title: question.slice(0, 100),
        course_canvas_id: courseId,
      });
      await history(d.conversation_id);
    } catch (e) {
      if (e instanceof AssistantRequestError && e.limits) {
        setState((current) =>
          current ? { ...current, limits: e.limits } : current,
        );
        setError("");
      } else setError((e as Error).message);
      if (
        e instanceof AssistantRequestError &&
        ["AI_PROVIDER_LIMIT", "AI_UNAVAILABLE"].includes(e.code)
      )
        intent.current = null;
      await reload().catch(() => {});
      if (conversation) await history(conversation.id).catch(() => {});
    } finally {
      setBusy(false);
      setSending("");
    }
  }
  return (
    <section
      ref={chat}
      className="assistant-chat"
      aria-label="Assistant conversation"
    >
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
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History size={16} />
          History
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={16} />
          Settings
        </Button>
        {state?.limits && (
          <span className="assistant-remaining">
            {state.limits.remaining_requests} messages left today
          </span>
        )}
        <Modal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title="Conversation history"
          description="Reopen or delete your saved conversations."
        >
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
                    setHistoryOpen(false);
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
        </Modal>
        <Modal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="AI settings"
          description="Control your free usage allowance and privacy."
        >
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
                exported in Privacy settings. Follow-ups share a rolling token
                allowance. There are no automatic provider retries or paid
                fallback. Keep provider data-retention controls configured in
                your Groq account.
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
        </Modal>
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
              setSettingsOpen(true);
            }}
          >
            Open AI settings
          </Button>
        </div>
      )}
      <div
        className="assistant-messages"
        ref={messages}
        role="log"
        aria-live="polite"
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
                  <div
                    className="chat-source-chips"
                    role="group"
                    aria-label="Records consulted"
                  >
                    {displaySources(x)
                      .slice(0, 2)
                      .map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          className="chat-source-chip"
                        >
                          {source.title}
                          <span>
                            {source.trust?.toLowerCase().includes("unverified")
                              ? "Unverified import"
                              : source.id.startsWith("canvas:")
                                ? "Canvas record"
                                : "Saved record"}
                          </span>
                        </a>
                      ))}
                  </div>
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
                              ? ` · Synced ${formatInTimeZone(s.retrieved_at, "America/Vancouver", "MMM d, h:mm a zzz")}`
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
            waiting ||
            !state?.configured ||
            !state.settings?.enabled ||
            !question.trim()
          }
        >
          <Send size={18} />
          <span className="sr-only">Send message</span>
        </Button>
      </form>
      {waiting && state?.limits && (
        <p className="assistant-limit" role="status">
          {limitMessage(state.limits)}{" "}
          {state.limits.reason !== "daily" && retryAt > now
            ? `Try again in ${Math.ceil((retryAt - now) / 1000)}s.`
            : ""}
          {!retryAt && (
            <button type="button" onClick={() => void reload()}>
              Refresh status
            </button>
          )}
        </p>
      )}
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

class AssistantRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public limits?: AssistantLimits,
  ) {
    super(message);
  }
}
async function assistantSend<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) {
    const limits =
      body.limits ??
      (body.error?.retry_at
        ? {
            available_tokens: 0,
            remaining_requests: 1,
            daily_limit: 10,
            reason: "provider",
            retry_at: body.error.retry_at,
            reset_at: body.error.retry_at,
          }
        : undefined);
    throw new AssistantRequestError(
      body.error?.message ??
        "The message could not be sent. Your draft is kept.",
      body.error?.code ?? "UNKNOWN",
      limits,
    );
  }
  return body;
}

function displaySources(exchange: Exchange) {
  const real = exchange.sources.filter(
    (source) =>
      source.id.startsWith("assessment:") ||
      source.id.startsWith("canvas:assignment:") ||
      source.id.startsWith("canvas:page_content:"),
  );
  const cited = exchange.sources.filter((source) =>
    exchange.response?.source_ids.includes(source.id),
  );
  return [
    ...new Map(
      [...real, ...cited].map((source) => [source.id, source]),
    ).values(),
  ];
}
