"use client";
import { useId, useState } from "react";
import { format, startOfWeek, addDays } from "date-fns";
import { ReviewCommitments } from "./review-commitments";
import { calendarRequest } from "./use-calendar";
import { PreparedWeeklyReview } from "./prepared-weekly-review";
import { WrittenReviewsPage } from "./reviews-page";
import { PersonalWorkflowsPanel } from "./personal-workflows-panel";
import { WorkSessionsPanel } from "./work-sessions-panel";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { TaskEditor } from "./task-editor";
import type { Review, Task } from "@/lib/schemas";
import type { AssistantReply } from "@/lib/assistant/provider";
import { localDate, friendlyDate } from "@/lib/dates";
export function ReviewsPage() {
  const { data, mutate, pending, notify } = useWorkspace();
  const summaryId = useId();
  const [week, setWeek] = useState(() =>
    format(
      startOfWeek(new Date(localDate() + "T12:00:00"), { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    ),
  );
  const [commitmentOpening, setCommitmentOpening] = useState("");
  const [active, setActive] = useState<string | null>(null),
    [summary, setSummary] = useState(""),
    [checked, setChecked] = useState(false),
    [candidate, setCandidate] = useState<AssistantReply | null>(null),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<{
    title: string;
    task: Task | null;
  } | null>(null);
  const review = data.reviews.find((r) => r.id === active);
  function payload(r?: Review) {
    return {
      period_start: r?.period_start ?? week,
      period_end:
        r?.period_end ??
        format(addDays(new Date(week + "T12:00:00"), 6), "yyyy-MM-dd"),
      completed_at: r?.completed_at ?? null,
      achievements: r?.achievements ?? "",
      obstacles: r?.obstacles ?? "",
      missed_commitments: r?.missed_commitments ?? "",
      decisions: r?.decisions ?? "",
      priorities: r?.priorities ?? "",
      conversation_summary: r?.conversation_summary ?? "",
    };
  }
  function open(r: Review) {
    setActive(r.id);
    setWeek(r.period_start);
    setSummary(r.conversation_summary ?? "");
    setCandidate(null);
    setChecked(false);
    setError("");
  }
  async function start() {
    setError("");
    try {
      const old = data.reviews.find((r) => r.period_start === week);
      if (old) {
        open(old);
        return;
      }
      const saved = (await mutate("reviews", null, payload())) as {
        data: Review;
      };
      open(saved.data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The review could not be opened.",
      );
    }
  }
  async function save(complete = false) {
    if (!review) return;
    setError("");
    try {
      await calendarRequest("/api/v1/reviews/context", {
        method: "POST",
        body: JSON.stringify({ action: "capture", review_id: review.id }),
      });
      await mutate(
        "reviews",
        review.id,
        {
          ...payload(review),
          conversation_summary: summary,
          completed_at: complete
            ? new Date().toISOString()
            : review.completed_at,
        },
        review.version,
      );
      notify(
        complete
          ? "Weekly conversation review completed"
          : "Reviewed summary saved",
      );
      setChecked(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The review could not be saved.",
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REFLECT. DECIDE. FOLLOW THROUGH.</span>
          <h1>Your weekly review</h1>
          <p>A conversation about your actual progress and what comes next.</p>
        </div>
      </div>
      <section className="panel weekly-review-start">
        <label>
          Review week starts
          <input
            type="date"
            value={week}
            disabled={!!review}
            onChange={(e) => setWeek(e.target.value)}
            required
          />
        </label>
        {review ? (
          <Button
            variant="outline"
            onClick={() => {
              setActive(null);
              setCandidate(null);
            }}
          >
            Review history
          </Button>
        ) : (
          <Button disabled={pending || !week} onClick={() => void start()}>
            Start weekly conversation
          </Button>
        )}
      </section>
      {review ? (
        <>
          <p className="small muted">
            Week of {friendlyDate(review.period_start)} ·{" "}
            {review.completed_at ? "Completed review" : "Saved draft"} · Your
            plans and reflection, together.
          </p>
          <PreparedWeeklyReview
            review={review}
            onReply={setCandidate}
            commitmentOpening={commitmentOpening}
          />
          <ReviewCommitments review={review} onOpening={setCommitmentOpening} />
          <section className="panel settings-panel">
            <h2>Your reviewed reflection</h2>
            <p className="small muted">
              Keep what feels useful. Review your reflection before saving it.
            </p>
            {candidate && (
              <Button
                variant="outline"
                onClick={() => {
                  setSummary(candidate.answer);
                  setChecked(false);
                }}
              >
                Use latest reply as a draft summary
              </Button>
            )}
            <label htmlFor={summaryId}>Review summary</label>
            <textarea
              id={summaryId}
              rows={4}
              maxLength={10000}
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                setChecked(false);
              }}
            />
            <label className="inline-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              I have reviewed this summary
            </label>
            <div className="career-import-actions">
              <Button
                variant="outline"
                disabled={pending || !checked || !summary.trim()}
                onClick={() => void save()}
              >
                Save reviewed summary
              </Button>
              <Button
                disabled={pending || !checked || !summary.trim()}
                onClick={() => void save(true)}
              >
                Complete conversation review
              </Button>
            </div>
            {!!candidate?.next_actions.length && (
              <div className="review-proposals">
                <h3>Proposed next actions</h3>
                <p className="small muted">
                  Choose an action to turn into a task. You’ll review it before
                  adding it.
                </p>
                {candidate.next_actions.slice(0, 3).map((action, i) => (
                  <div className="setting-line" key={i}>
                    <span>{action}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft({ title: action.slice(0, 200), task: null })
                      }
                    >
                      Draft task
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="panel settings-panel">
          <h2>Saved weekly conversations</h2>
          {data.reviews.length ? (
            data.reviews
              .slice()
              .sort((a, b) => b.period_start.localeCompare(a.period_start))
              .slice(0, 12)
              .map((r) => (
                <button
                  className="review-history full-width button-ghost"
                  key={r.id}
                  onClick={() => open(r)}
                >
                  <strong>Resume week of {friendlyDate(r.period_start)}</strong>
                  <span className="small muted">
                    {r.completed_at ? "Completed" : "Draft"}
                  </span>
                </button>
              ))
          ) : (
            <p className="muted">
              Start with the week you want to review. Your conversation will
              stay linked to it.
            </p>
          )}
        </section>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <details className="panel written-review-fallback">
        <summary className="text-link">
          Written review form and older reflections
        </summary>
        <WrittenReviewsPage />
      </details>
      <details className="panel">
        <summary>Past check-ins and briefings</summary>
        <PersonalWorkflowsPanel />
      </details>
      <WorkSessionsPanel
        compact
        start={week}
        end={format(addDays(new Date(week + "T12:00:00"), 7), "yyyy-MM-dd")}
      />
      {draft && (
        <TaskEditor
          key={draft.task?.id ?? draft.title}
          task={draft.task}
          defaultTitle={draft.title}
          defaultDescription={`Proposed during the weekly review beginning ${week}. Confirm details before committing.`}
          onCreated={(task) => setDraft({ title: task.title, task })}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
