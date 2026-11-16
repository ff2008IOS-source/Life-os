"use client";
import { useRef, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { useWorkspace } from "./workspace-provider";
type Preview = { token: string; counts: Record<string, number> };
export function ActivityReset() {
  const { refresh } = useWorkspace();
  const [preview, setPreview] = useState<Preview | null>(null),
    [phrase, setPhrase] = useState(""),
    [rebuild, setRebuild] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const intent = useRef<string | null>(null);
  async function review() {
    setBusy(true);
    setMessage("");
    try {
      setPreview(await calendarRequest<Preview>("/api/v1/workspace/reset"));
      setPhrase("");
      intent.current = crypto.randomUUID();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not review activity.");
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    if (!preview || busy || !intent.current) return;
    setBusy(true);
    try {
      await calendarRequest("/api/v1/workspace/reset", {
        method: "POST",
        body: JSON.stringify({
          token: preview.token,
          request_id: intent.current,
          confirmation: phrase,
          rebuild_source_backed: rebuild,
        }),
      });
      setPreview(null);
      await refresh();
      window.dispatchEvent(new Event("lifeos:changed"));
      setMessage(
        "Activity cleared. Courses, grades, materials, goals and connections are preserved. Automatic planning is paused. Use Sync all when you’re ready.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Reset could not be confirmed. Review the current workspace before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <h2>A fresh workspace</h2>
      <p>
        Clear tasks, projects, reviews, conversations, check-ins and recorded
        work. Keep your academic and connected-source data, goals and
        preferences. A private recovery snapshot is retained; external calendars
        and spreadsheets are unchanged.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void review()}>
        Review activity reset
      </Button>
      {message && <p role="status">{message}</p>}
      {preview && (
        <Modal
          open
          title="Clear your activity"
          description="Review exactly what will be cleared before continuing."
          onOpenChange={(v) => {
            if (!busy && !v) setPreview(null);
          }}
        >
          <p>
            {preview.counts.tasks ?? 0} tasks · {preview.counts.projects ?? 0}{" "}
            projects · {preview.counts.reviews ?? 0} reviews ·{" "}
            {preview.counts.assistant_conversations ?? 0} conversations ·{" "}
            {preview.counts.work_completions ?? 0} recorded work sessions
          </p>
          <p>
            Course records, grades, materials, goals and connections are
            preserved. Automatic planning is paused.
          </p>
          <label>
            <input
              type="checkbox"
              checked={rebuild}
              onChange={(e) => setRebuild(e.target.checked)}
            />{" "}
            Rebuild source-backed tasks and projects when I use Sync all
          </label>
          <label>
            Type CLEAR MY ACTIVITY
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
            />
          </label>
          <Button
            disabled={busy || phrase !== "CLEAR MY ACTIVITY"}
            onClick={() => void clear()}
          >
            {busy ? "Clearing…" : "Clear activity"}
          </Button>
          {message && <p role="alert">{message}</p>}
        </Modal>
      )}
    </section>
  );
}
