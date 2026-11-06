"use client";
import { useState } from "react";
import { Plus, Target, Flag, ArrowUpRight } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { EmptyState } from "./task-list";
import { EntityEditor, type EntityEditorState } from "./entity-editor";
import { goalProgress } from "@/lib/insights";
import { friendlyDate } from "@/lib/dates";
export function GoalsPage() {
  const { data } = useWorkspace();
  const [editor, setEditor] = useState<EntityEditorState | null>(null);
  const [status, setStatus] = useState("active");
  const goals = data.goals.filter(
    (g) => status === "all" || g.status === status,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A DIRECTION THAT MATTERS</span>
          <h1>Your goals</h1>
          <p>Connect the things you do to the life you’re building.</p>
        </div>
        <Button onClick={() => setEditor({ kind: "goals" })}>
          <Plus size={14} />
          New goal
        </Button>
      </div>
      <div className="tabs">
        {["active", "paused", "completed", "all"].map((s) => (
          <button
            className={`tab ${status === s ? "active" : ""}`}
            key={s}
            onClick={() => setStatus(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {goals.length ? (
        <div className="cards-grid">
          {goals.map((g) => {
            const progress = goalProgress(g, data.milestones);
            const milestones = data.milestones.filter(
              (m) => m.goal_id === g.id,
            );
            const area = data.areas.find((a) => a.id === g.area_id);
            return (
              <article className="entity-card" key={g.id}>
                <div className="flex-between full-width">
                  <span className="section-icon">
                    <Target />
                  </span>
                  <span className="badge blue">
                    {g.progress_type === "milestone"
                      ? "Milestone-based"
                      : g.progress_type}
                  </span>
                </div>
                {area && (
                  <span className="badge">
                    <span
                      className="area-dot"
                      style={{ background: area.color }}
                    />
                    {area.name}
                  </span>
                )}
                <button
                  className="task-main"
                  onClick={() => setEditor({ kind: "goals", record: g })}
                >
                  <h2>{g.title}</h2>
                </button>
                <p>
                  {g.description || "Add the outcome you’re working toward."}
                </p>
                <div className="full-width">
                  <div className="flex-between small muted">
                    <span>{progress.label}</span>
                    {progress.percent !== null && (
                      <span>{Math.round(progress.percent)}%</span>
                    )}
                  </div>
                  {progress.percent !== null && (
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={g.title}
                      aria-valuenow={Math.round(progress.percent)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="progress-fill"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  )}
                </div>
                {milestones.map((m) => (
                  <button
                    className="task-main"
                    key={m.id}
                    onClick={() => setEditor({ kind: "milestones", record: m })}
                  >
                    <span className="small">
                      <Flag
                        size={11}
                        style={{ display: "inline", marginRight: 6 }}
                      />
                      {m.title} · {m.status}
                    </span>
                  </button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEditor({ kind: "milestones", goalId: g.id })
                  }
                >
                  <Plus size={12} />
                  Add milestone
                </Button>
                <div className="card-footer">
                  <span>{friendlyDate(g.target_date)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditor({ kind: "goals", record: g })}
                  >
                    Edit
                    <ArrowUpRight size={12} />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            icon={Target}
            title="Start with a meaningful outcome"
            description="Your goals can be numeric, milestone-based, binary, or qualitative. There is no need to turn everything into a percentage."
            action={
              <Button onClick={() => setEditor({ kind: "goals" })}>
                <Plus size={14} />
                Create a goal
              </Button>
            }
          />
        </section>
      )}
      {editor && (
        <EntityEditor state={editor} onClose={() => setEditor(null)} />
      )}
    </>
  );
}
