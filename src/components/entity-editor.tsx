"use client";
import { useState } from "react";
import type { Project, Goal, Milestone } from "@/lib/schemas";
import { useWorkspace } from "./workspace-provider";
import { Modal } from "./dialog";
import { Button } from "./ui/button";
type Seed = { seed?: Partial<Project & Goal & Milestone> };
export type EntityEditorState = (
  | { kind: "projects"; record?: Project }
  | { kind: "goals"; record?: Goal }
  | {
      kind: "milestones";
      record?: Milestone;
      goalId?: string;
      projectId?: string;
    }
) &
  Seed;
export function EntityEditor({
  state,
  onClose,
}: {
  state: EntityEditorState;
  onClose: () => void;
}) {
  const { data, mutate, notify, pending } = useWorkspace();
  const [error, setError] = useState("");
  const rec = state.record;
  const goal: Partial<Goal> | undefined =
    state.kind === "goals" ? (state.record ?? state.seed) : undefined;
  const project: Partial<Project> | undefined =
    state.kind === "projects" ? (state.record ?? state.seed) : undefined;
  const milestone: Partial<Milestone> | undefined =
    state.kind === "milestones" ? (state.record ?? state.seed) : undefined;
  const [progress, setProgress] = useState(goal?.progress_type ?? "milestone");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = (k: string) => f.get(k) || null;
    let values: unknown;
    if (state.kind === "projects")
      values = {
        name: f.get("name"),
        description: f.get("description"),
        area_id: value("area_id"),
        status: f.get("status"),
        start_date: project?.start_date ?? null,
        target_date: value("target_date"),
        automation_enabled: f.get("automation_enabled") === "on",
      };
    else if (state.kind === "goals")
      values = {
        title: f.get("title"),
        description: f.get("description"),
        area_id: value("area_id"),
        parent_goal_id: goal?.parent_goal_id ?? null,
        status: f.get("status"),
        progress_type: progress,
        target_value:
          progress === "numeric" && value("target_value")
            ? Number(value("target_value"))
            : null,
        current_value:
          progress === "numeric" && value("current_value")
            ? Number(value("current_value"))
            : null,
        unit: progress === "numeric" ? value("unit") : null,
        start_date: goal?.start_date ?? null,
        target_date: value("target_date"),
      };
    else
      values = {
        title: f.get("title"),
        goal_id: value("goal_id"),
        project_id: value("project_id"),
        target_date: value("target_date"),
        status: f.get("status"),
        evidence_url: value("evidence_url"),
      };
    try {
      await mutate(state.kind, rec?.id ?? null, values, rec?.version);
      notify(rec ? "Changes saved" : "Record created");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    }
  }
  const noun =
    state.kind === "projects"
      ? "project"
      : state.kind === "goals"
        ? "goal"
        : "milestone";
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${rec ? "Edit" : "New"} ${noun}`}
      description={
        state.kind === "goals"
          ? "Define an outcome that matters to you."
          : state.kind === "projects"
            ? "Give a coordinated effort a home."
            : "Choose an important checkpoint and what it supports."
      }
    >
      <form onSubmit={submit}>
        <label>
          {state.kind === "projects" ? "Name" : "Title"}
          <input
            name={state.kind === "projects" ? "name" : "title"}
            defaultValue={
              project?.name ?? goal?.title ?? milestone?.title ?? ""
            }
            placeholder={`Your ${noun}`}
            required
            maxLength={200}
            autoFocus
          />
        </label>
        {state.kind !== "milestones" && (
          <>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={project?.description ?? goal?.description ?? ""}
              />
            </label>
            <label>
              Life area
              <select
                name="area_id"
                defaultValue={project?.area_id ?? goal?.area_id ?? ""}
              >
                <option value="">No area</option>
                {data.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {state.kind === "milestones" && (
          <div className="form-grid">
            <label>
              Goal
              <select
                name="goal_id"
                defaultValue={milestone?.goal_id ?? state.goalId ?? ""}
              >
                <option value="">No goal</option>
                {data.goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                name="project_id"
                defaultValue={milestone?.project_id ?? state.projectId ?? ""}
              >
                <option value="">No project</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="form-grid">
          <label>
            Status
            <select
              name="status"
              defaultValue={
                rec?.status ??
                (state.kind === "milestones" ? "planned" : "active")
              }
            >
              {state.kind === "milestones" ? (
                <>
                  <option value="planned">Planned</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </>
              ) : (
                <>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </>
              )}
            </select>
          </label>
          <label>
            Target date
            <input
              name="target_date"
              type="date"
              defaultValue={rec?.target_date ?? ""}
            />
          </label>
        </div>
        {state.kind === "goals" && (
          <>
            <label>
              Progress type
              <select
                value={progress}
                onChange={(e) => setProgress(e.target.value as typeof progress)}
              >
                <option value="milestone">Milestone-based</option>
                <option value="numeric">Numeric</option>
                <option value="binary">Binary</option>
                <option value="qualitative">Qualitative</option>
              </select>
            </label>
            {progress === "numeric" && (
              <>
                <div className="form-grid">
                  <label>
                    Current value
                    <input
                      type="number"
                      name="current_value"
                      min="0"
                      step="any"
                      defaultValue={goal?.current_value ?? ""}
                    />
                  </label>
                  <label>
                    Target value
                    <input
                      type="number"
                      name="target_value"
                      min="0.000001"
                      step="any"
                      required
                      defaultValue={goal?.target_value ?? ""}
                    />
                  </label>
                </div>
                <label>
                  Unit
                  <input
                    name="unit"
                    placeholder="hours, applications, etc."
                    defaultValue={goal?.unit ?? ""}
                  />
                </label>
              </>
            )}
            {progress === "qualitative" && (
              <p className="form-hint">
                Progress is described in your notes and reviews, without a
                percentage.
              </p>
            )}
          </>
        )}
        {state.kind === "projects" && (
          <label className="check-label">
            <input
              type="checkbox"
              name="automation_enabled"
              defaultChecked={project?.automation_enabled}
            />
            Include eligible project tasks in previews
          </label>
        )}
        {state.kind === "milestones" && (
          <label>
            Evidence URL
            <input
              name="evidence_url"
              type="url"
              defaultValue={milestone?.evidence_url ?? ""}
              placeholder="https://…"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : `Save ${noun}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
