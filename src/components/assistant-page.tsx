"use client";
import { useState, useEffect, useRef } from "react";
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
  courses: { id: string; name: string }[];
  usage: { requests: number; reserved_tokens: number } | null;
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
    [course, setCourse] = useState(""),
    [question, setQuestion] = useState(""),
    [exchanges, setExchanges] = useState<Exchange[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const intent = useRef<{
    id: string;
    question: string;
    conversation: string | null;
    course: string | null;
  } | null>(null);
  const reload = async () =>
    setState(await calendarRequest<State>("/api/v1/assistant"));
  useEffect(() => {
    let active = true;
    void calendarRequest<State>("/api/v1/assistant")
      .then((d) => {
        if (active) setState(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function history(id: string) {
    setExchanges(
      (
        await calendarRequest<{ exchanges: Exchange[] }>(
          `/api/v1/assistant?conversation=${id}`,
        )
      ).exchanges,
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Life OS assistant</h1>
          <p>Ask about saved work or selected course material.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <p className="form-hint">
          AI answers are recommendations, not verified records. The assistant
          cannot change your tasks, grades, calendar or mastery. Retrieved
          content covers only a bounded subset of saved records.
        </p>
        <details>
          <summary className="text-link" style={{ minHeight: 44 }}>
            AI settings and privacy
          </summary>
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
              Only selected task/goal/project facts, course excerpts and recent
              conversation context are sent to Groq. Canvas credentials are
              never included. Conversations stay in Life OS and can be deleted
              below or exported in Privacy settings. One request per minute, no
              automatic provider retries or paid fallback. Keep provider
              data-retention controls configured in your Groq account.
            </p>
            <Button disabled={busy || !state}>Save AI settings</Button>
          </form>
        </details>
        <p className="small muted">
          {state?.configured
            ? "Groq server key configured"
            : "Groq is not configured for this deployment"}{" "}
          · {state?.usage?.requests ?? 0} requests reserved today · Model:
          GPT-OSS 20B via Groq
        </p>
        <div className="form-grid">
          <label>
            Conversation
            <select
              value={conversation?.id ?? ""}
              onChange={async (e) => {
                const c =
                  state?.conversations.find((c) => c.id === e.target.value) ??
                  null;
                setConversation(c);
                setCourse(c?.course_canvas_id ?? "");
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
          <label>
            Course context
            <select
              value={course}
              disabled={!!conversation}
              onChange={(e) => setCourse(e.target.value)}
            >
              <option value="">General Life OS records</option>
              {state?.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="form-hint">
          Latest 30 conversations and exchanges shown. Full retained history is
          included in your user export.
        </p>
        {exchanges.map((x) => (
          <article key={x.id} className="setting-line">
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong>You: {x.question}</strong>
              {x.response ? (
                <>
                  <p style={{ whiteSpace: "pre-wrap" }}>{x.response.answer}</p>
                  {x.response.unknowns.length > 0 && (
                    <p className="small muted">
                      Unknown: {x.response.unknowns.join(" · ")}
                    </p>
                  )}
                  {x.response.next_actions.length > 0 && (
                    <p className="small">
                      Suggested only: {x.response.next_actions.join(" · ")}
                    </p>
                  )}
                  <details>
                    <summary className="text-link">
                      Sources supplied for this answer
                    </summary>
                    {x.sources
                      .filter((s) => x.response!.source_ids.includes(s.id))
                      .map((s) => (
                        <p key={s.id} className="small">
                          <a href={s.url} className="text-link">
                            {s.title}
                          </a>
                          {s.retrieved_at
                            ? ` · Saved ${new Date(s.retrieved_at).toLocaleString()}`
                            : ""}
                        </p>
                      ))}
                  </details>
                </>
              ) : (
                <p className="small muted">
                  {x.error ??
                    "This request may still be processing. Reload its conversation before sending a duplicate."}
                </p>
              )}
            </div>
          </article>
        ))}
        <form
          className="academic-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const courseId = course || null;
            if (
              !intent.current ||
              intent.current.question !== question ||
              intent.current.conversation !== (conversation?.id ?? null) ||
              intent.current.course !== courseId
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
            }
          }}
        >
          <label>
            Your question
            <textarea
              required
              maxLength={1500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should I prioritize? Explain a topic from my selected course…"
            />
          </label>
          <Button
            disabled={
              busy ||
              !state?.configured ||
              !state.settings?.enabled ||
              !question.trim()
            }
          >
            {busy ? "Preparing answer…" : "Ask assistant"}
          </Button>
        </form>
        {conversation && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "Delete this conversation and its exchanges? Usage counters remain to protect your allowance.",
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
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
