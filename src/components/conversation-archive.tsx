"use client";
import { useEffect, useState, useId } from "react";
import { calendarRequest } from "./use-calendar";
export function ConversationArchive() {
  const selectId = useId();
  const [conversations, setConversations] = useState<
      { id: string; title: string }[]
    >([]),
    [selected, setSelected] = useState(""),
    [messages, setMessages] = useState<
      {
        id: string;
        question: string;
        response: { answer: string } | null;
        status: string;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void calendarRequest<{ conversations: { id: string; title: string }[] }>(
      "/api/v1/assistant",
    )
      .then((d) => {
        if (live) setConversations(d.conversations);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    void calendarRequest<{ exchanges: typeof messages }>(
      `/api/v1/assistant?conversation=${selected}`,
    )
      .then((d) => {
        if (live) {
          setMessages(d.exchanges);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Saved conversation archive</h1>
        </div>
      </div>
      <section className="panel briefing-card">
        <label htmlFor={selectId}>Saved conversations</label>
        <select
          id={selectId}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setMessages([]);
          }}
        >
          <option value="">Choose a conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <p className="small muted">
          Latest 30 conversations and 30 exchanges shown. Retained history is
          included in your private data export.
        </p>
        {error && <p role="alert">{error}</p>}
        <div role="log" aria-label="Archived exchanges">
          {messages.map((m) => (
            <article className="briefing-alternative" key={m.id}>
              <h2>{m.question}</h2>
              <p>{m.response?.answer ?? `No completed reply (${m.status}).`}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
