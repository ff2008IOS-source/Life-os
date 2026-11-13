"use client";
import { useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import type { DailyCheckIn } from "@/lib/briefing";
export function DailyCheckInPanel({
  today,
  timezone,
}: {
  today: string;
  timezone: string;
}) {
  const { data: w } = useWorkspace();
  const [day, setDay] = useState(today),
    [row, setRow] = useState<DailyCheckIn | null>(null),
    [step, setStep] = useState(0),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void calendarRequest<{ check_in: DailyCheckIn | null }>(
      `/api/v1/briefing?day=${day}`,
    )
      .then((r) => {
        if (live) {
          setRow(
            r.check_in ?? {
              day,
              timezone,
              accomplishments: "",
              obstacles: "",
              unfinished_commitments: "",
              follow_up: "",
              task_id: null,
              goal_id: null,
              status: "draft",
              version: 0,
            },
          );
          setStep(r.check_in?.status === "completed" ? 3 : 0);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [day, timezone]);
  const fields = ["accomplishments", "obstacles", "follow_up"] as const;
  const questions = [
    "What was the most important thing you accomplished?",
    "What got in the way or stayed unfinished?",
    "What is one realistic next step? (Optional)",
  ];
  async function save(status: DailyCheckIn["status"], next?: number) {
    if (!row) return;
    setSaving(true);
    setError("");
    try {
      const { version, ...values } = row;
      const r = await calendarRequest<{ data: DailyCheckIn }>(
        "/api/v1/briefing",
        {
          method: "POST",
          body: JSON.stringify({
            type: "check_in",
            version: version || null,
            data: { ...values, status },
          }),
        },
      );
      const d = r.data;
      setRow({
        day: d.day,
        timezone: d.timezone,
        accomplishments: d.accomplishments,
        obstacles: d.obstacles,
        unfinished_commitments: d.unfinished_commitments,
        follow_up: d.follow_up,
        task_id: d.task_id,
        goal_id: d.goal_id,
        status: d.status,
        version: d.version,
      });
      if (next !== undefined) setStep(next);
      window.dispatchEvent(new Event("lifeos:changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check-in could not save.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel briefing-card" aria-labelledby="check-in-title">
      <div className="panel-heading">
        <h2 id="check-in-title">Daily Check-In</h2>
        <input
          aria-label="Check-in date"
          type="date"
          value={day}
          max={today}
          disabled={saving}
          onChange={(e) => {
            setLoading(true);
            setDay(e.target.value);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Loading your check-in…</p>
      ) : (
        row && (
          <>
            {step < 3 ? (
              <>
                <p className="check-in-question">{questions[step]}</p>
                <textarea
                  aria-label="Check-in answer"
                  disabled={saving}
                  value={row[fields[step]]}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) =>
                    setRow({ ...row, [fields[step]]: e.target.value })
                  }
                />
                <div className="briefing-actions">
                  <Button
                    disabled={saving}
                    onClick={() =>
                      void save(step === 2 ? "completed" : "draft", step + 1)
                    }
                  >
                    {step === 2 ? "Finish check-in" : "Save and continue"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void save("skipped", 3)}
                  >
                    Skip for now
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  {row.status === "skipped"
                    ? "Skipped for now. You can return whenever useful."
                    : "Your responses are saved. Reflection is separate from task completion."}
                </p>
                <dl className="briefing-reflection">
                  <dt>Accomplishment</dt>
                  <dd>{row.accomplishments || "Not recorded"}</dd>
                  <dt>Obstacles / unfinished work</dt>
                  <dd>{row.obstacles || "Not recorded"}</dd>
                  <dt>Next step</dt>
                  <dd>{row.follow_up || "Not recorded"}</dd>
                </dl>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setStep(0)}
                >
                  Edit responses
                </Button>
              </>
            )}
            <details className="briefing-detail">
              <summary>
                Optional verified links and unfinished commitments
              </summary>
              <p className="small muted">
                Choose a record yourself. Saving a reflection never completes it
                or creates a new task.
              </p>
              <label>
                Unfinished commitment
                <textarea
                  rows={2}
                  maxLength={2000}
                  disabled={saving}
                  value={row.unfinished_commitments}
                  onChange={(e) =>
                    setRow({ ...row, unfinished_commitments: e.target.value })
                  }
                />
              </label>
              <label>
                Linked task
                <select
                  disabled={saving}
                  value={row.task_id ?? ""}
                  onChange={(e) =>
                    setRow({ ...row, task_id: e.target.value || null })
                  }
                >
                  <option value="">No task link</option>
                  {w.tasks
                    .filter((t) => !t.deleted_at)
                    .slice(0, 500)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Linked goal
                <select
                  disabled={saving}
                  value={row.goal_id ?? ""}
                  onChange={(e) =>
                    setRow({ ...row, goal_id: e.target.value || null })
                  }
                >
                  <option value="">No goal link</option>
                  {w.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => void save(row.status)}
              >
                Save links
              </Button>
            </details>
          </>
        )
      )}
    </section>
  );
}
