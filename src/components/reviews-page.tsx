"use client";
import { useState } from "react";
import { startOfWeek, addDays, format } from "date-fns";
import { BookOpen, ArrowLeft, ArrowRight, Check, Plus } from "lucide-react";
import type { Review } from "@/lib/schemas";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { EmptyState } from "./task-list";
import { localDate, friendlyDate, isOverdue } from "@/lib/dates";
const steps = [
  {
    title: "Look back",
    field: "achievements",
    prompt: "What moved forward?",
    description:
      "Review your recorded commitments and completed tasks. What feels meaningful?",
  },
  {
    title: "Check your areas",
    field: "missed_commitments",
    prompt: "What needs another look?",
    description:
      "Consider Academics, Career, Projects, and any optional areas you are using.",
  },
  {
    title: "Reconnect with goals",
    field: "decisions",
    prompt: "What will you keep, change, or pause?",
    description:
      "Review your goals and milestones. Make decisions that reflect your current priorities.",
  },
  {
    title: "Make adjustments",
    field: "obstacles",
    prompt: "What got in the way?",
    description:
      "Name obstacles and useful adjustments without judging your productivity.",
  },
  {
    title: "Choose what’s next",
    field: "priorities",
    prompt: "What matters most next week?",
    description:
      "Choose a few realistic priorities. Saving a review does not create new tasks automatically.",
  },
] as const;
export function WrittenReviewsPage() {
  const { data, mutate, notify, pending } = useWorkspace();
  const [editing, setEditing] = useState<Review | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState({
    achievements: "",
    missed_commitments: "",
    decisions: "",
    obstacles: "",
    priorities: "",
  });
  const [error, setError] = useState("");
  const [period, setPeriod] = useState(() =>
    format(
      startOfWeek(new Date(localDate() + "T12:00:00"), { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    ),
  );
  function open(review: Review | null) {
    setEditing(review);
    setStep(0);
    setPeriod(
      review?.period_start ??
        format(
          startOfWeek(new Date(localDate() + "T12:00:00"), { weekStartsOn: 1 }),
          "yyyy-MM-dd",
        ),
    );
    setFields({
      achievements: review?.achievements ?? "",
      missed_commitments: review?.missed_commitments ?? "",
      decisions: review?.decisions ?? "",
      obstacles: review?.obstacles ?? "",
      priorities: review?.priorities ?? "",
    });
    setError("");
  }
  async function save(complete: boolean) {
    setError("");
    try {
      const end = format(
        addDays(new Date(period + "T12:00:00"), 6),
        "yyyy-MM-dd",
      );
      const result = (await mutate(
        "reviews",
        editing?.id ?? null,
        {
          ...fields,
          conversation_summary: editing?.conversation_summary ?? "",
          period_start: period,
          period_end: end,
          completed_at: complete
            ? new Date().toISOString()
            : (editing?.completed_at ?? null),
        },
        editing?.version,
      )) as { data: Review };
      setEditing(complete ? undefined : result.data);
      notify(complete ? "Weekly review completed" : "Review draft saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save review");
    }
  }
  const periodEnd = format(
    addDays(new Date(period + "T12:00:00"), 6),
    "yyyy-MM-dd",
  );
  const completed = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      t.completed_at &&
      localDate(t.completed_at) >= period &&
      localDate(t.completed_at) <= periodEnd,
  );
  const missed = data.tasks.filter((t) => isOverdue(t));
  const milestones = data.milestones.filter(
    (m) =>
      m.status === "completed" &&
      m.completed_at &&
      localDate(m.completed_at) >= period &&
      localDate(m.completed_at) <= periodEnd,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PAUSE. REFLECT. RESET.</span>
          <h2>Written reviews</h2>
          <p>A clearer next week starts with a little reflection.</p>
        </div>
        {editing === undefined && (
          <Button
            onClick={() =>
              open(data.reviews.find((r) => r.period_start === period) ?? null)
            }
          >
            <Plus size={14} />
            Start review
          </Button>
        )}
      </div>
      {editing === undefined ? (
        <section className="panel">
          <div className="panel-heading">
            <div className="panel-title">
              <BookOpen />
              <h2>Your review history</h2>
            </div>
            <span className="badge">Saved reflections</span>
          </div>
          {data.reviews.length ? (
            data.reviews
              .slice()
              .sort((a, b) => b.period_start.localeCompare(a.period_start))
              .map((r) => (
                <button
                  className="review-history full-width button-ghost"
                  style={{
                    border: 0,
                    borderTop: "1px solid var(--border)",
                    textAlign: "left",
                  }}
                  key={r.id}
                  onClick={() => open(r)}
                >
                  <div>
                    <strong>Week of {friendlyDate(r.period_start)}</strong>
                    <p className="small muted">
                      {r.completed_at ? "Completed" : "Draft"}
                    </p>
                  </div>
                  <ArrowRight size={15} />
                </button>
              ))
          ) : (
            <EmptyState
              icon={BookOpen}
              title="Build a habit of looking back"
              description="A guided five-step review, using your recorded data. Usually 10–15 minutes; take the time you need."
              action={
                <Button onClick={() => open(null)}>
                  Start your first review
                  <ArrowRight size={13} />
                </Button>
              }
            />
          )}
        </section>
      ) : (
        <>
          <Button
            variant="ghost"
            size="sm"
            style={{ marginBottom: 15 }}
            onClick={() => setEditing(undefined)}
          >
            <ArrowLeft size={13} />
            Review history
          </Button>
          <div className="review-layout">
            <aside className="review-steps" aria-label="Review steps">
              {steps.map((s, i) => (
                <button
                  key={s.field}
                  className={`review-step ${i === step ? "active" : ""}`}
                  onClick={() => setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className="step-number">{i + 1}</span>
                  {s.title}
                </button>
              ))}
            </aside>
            <section className="panel review-form">
              <span className="eyebrow">STEP {step + 1} OF 5</span>
              <h2 style={{ marginTop: 10 }}>{steps[step].title}</h2>
              <p>{steps[step].description}</p>
              <label style={{ marginBottom: 18 }}>
                Review week starts
                <input
                  type="date"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  required
                />
              </label>
              <div className="review-context">
                {step === 0 ? (
                  <>
                    <strong>
                      {completed.length} tasks completed in this period
                    </strong>
                    {completed.map((t) => (
                      <p key={t.id}>✓ {t.title}</p>
                    ))}
                  </>
                ) : step === 1 ? (
                  <>
                    {data.areas.map((a) => (
                      <p key={a.id}>
                        {a.name}:{" "}
                        {
                          data.tasks.filter(
                            (t) =>
                              t.area_id === a.id &&
                              !t.deleted_at &&
                              !["completed", "cancelled"].includes(t.status),
                          ).length
                        }{" "}
                        active tasks
                      </p>
                    ))}
                    <p style={{ marginTop: 8 }}>
                      {missed.length} currently overdue tasks. Optional areas
                      with no entries have no recorded data.
                    </p>
                  </>
                ) : step === 2 ? (
                  <>
                    <p>
                      {data.goals.filter((g) => g.status === "active").length}{" "}
                      active goals · {milestones.length} milestones completed
                      this period
                    </p>
                    {data.goals
                      .filter((g) => g.status === "active")
                      .map((g) => (
                        <p key={g.id}>• {g.title}</p>
                      ))}
                  </>
                ) : step === 3 ? (
                  <p>
                    Current overdue commitments:{" "}
                    {missed.map((t) => t.title).join("; ") || "None recorded"}.
                    Consider capacity, uncertainty, and anything your task
                    history cannot capture.
                  </p>
                ) : (
                  <p>
                    Your next priorities will be saved with this review. Add
                    concrete tasks separately when you are ready.
                  </p>
                )}
                <p className="data-source">
                  Source: recorded tasks, goals, milestones · {period}–
                  {periodEnd}. Current overdue snapshot is labeled separately.
                </p>
              </div>
              <label>
                {steps[step].prompt}
                <textarea
                  rows={6}
                  maxLength={10000}
                  value={fields[steps[step].field]}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      [steps[step].field]: e.target.value,
                    })
                  }
                  placeholder="A few honest notes are enough…"
                />
              </label>
              {error && (
                <p
                  role="alert"
                  className="error-message"
                  style={{ marginTop: 12 }}
                >
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <Button
                  variant="ghost"
                  onClick={() => save(false)}
                  disabled={pending || !period}
                >
                  Save draft
                </Button>
                {step > 0 && (
                  <Button variant="outline" onClick={() => setStep(step - 1)}>
                    <ArrowLeft size={13} />
                    Back
                  </Button>
                )}
                {step < 4 ? (
                  <Button onClick={() => setStep(step + 1)}>
                    Continue
                    <ArrowRight size={13} />
                  </Button>
                ) : (
                  <Button
                    onClick={() => save(true)}
                    disabled={pending || !period}
                  >
                    <Check size={13} />
                    Complete review
                  </Button>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
