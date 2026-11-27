"use client";
import { dayLabel } from "@/lib/display";
import { visibleArea } from "@/lib/visible-areas";
import { realWorkspace } from "@/lib/real-workspace";
import Link from "next/link";
import { CareerWorkspace } from "./career-workspace";
import { AcademicsPanel } from "./academics-panel";
import { projectSummary } from "@/lib/project-summary";
import { useState } from "react";
import {
  GraduationCap,
  BriefcaseBusiness,
  Layers3,
  Wallet,
  Heart,
  ArrowUpRight,
  Plus,
  Flag,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { EmptyState, TaskList, QuickCapture } from "./task-list";
import { Button } from "./ui/button";
import { EntityEditor, type EntityEditorState } from "./entity-editor";
import { friendlyDate } from "@/lib/dates";
const icons: Record<string, typeof Layers3> = {
  academics: GraduationCap,
  career: BriefcaseBusiness,
  projects: Layers3,
  finances: Wallet,
  wellbeing: Heart,
};
const descriptions: Record<string, string> = {
  academics: "Your courses, study, and academic commitments.",
  career: "Build toward the work you want to do.",
  projects: "Give your ideas a clear path forward.",
  finances: "Understand your money, on your terms.",
  wellbeing: "Make room for the things that sustain you.",
};
export function AreasPage({
  slug,
  initialCourse,
  initialView,
  initialAssessment,
}: {
  slug?: string;
  initialCourse?: string;
  initialView?: string;
  initialAssessment?: string;
}) {
  const { data: raw } = useWorkspace();
  const data = realWorkspace(raw);
  const [editor, setEditor] = useState<EntityEditorState | null>(null);
  const [tab, setTab] = useState("overview");
  const [projectQuery, setProjectQuery] = useState("");
  const area = data.areas.find((a) => a.slug === slug);
  const projects = data.projects.filter(
    (p) =>
      !p.archived_at &&
      !p.deleted_at &&
      (!slug || p.area_id === area?.id || slug === "projects") &&
      (slug !== "projects" ||
        `${p.name} ${p.description}`
          .toLowerCase()
          .includes(projectQuery.toLowerCase())),
  );
  if (!slug)
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">ROOM FOR EVERY PART OF LIFE</span>
            <h1>Workspaces</h1>
          </div>
        </div>
        {!data.areas.length ? (
          <EmptyState
            icon={Layers3}
            title="Set up your life areas"
            description="Set up your workspace from Home to get started."
            action={
              <Button asChild variant="outline">
                <Link href="/">Go to Home</Link>
              </Button>
            }
          />
        ) : (
          <div className="cards-grid">
            {data.areas.filter(visibleArea).map((a) => {
              const Icon = icons[a.slug] ?? Layers3;
              const count = data.tasks.filter(
                (t) =>
                  t.area_id === a.id &&
                  !t.deleted_at &&
                  !["completed", "cancelled"].includes(t.status),
              ).length;
              return (
                <Link
                  href={`/areas/${a.slug}`}
                  className="entity-card"
                  key={a.id}
                >
                  <span
                    className="section-icon"
                    style={{ background: a.color + "15", color: a.color }}
                  >
                    <Icon />
                  </span>
                  <h2>{a.name}</h2>
                  <p>{descriptions[a.slug]}</p>
                  <div className="card-footer">
                    <span>
                      {["finances", "wellbeing"].includes(a.slug)
                        ? "Optional · starts empty"
                        : `${count} active ${count === 1 ? "task" : "tasks"}`}
                    </span>
                    <ArrowUpRight size={14} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </>
    );
  if (!area)
    return (
      <EmptyState
        title="This area isn’t initialized"
        description="Initialize your workspace from Home first."
        action={
          <Link className="text-link" href="/">
            Go to Home →
          </Link>
        }
      />
    );
  const Icon = icons[slug] ?? Layers3;
  const tasks = data.tasks.filter(
    (t) => t.area_id === area.id && !t.deleted_at,
  );
  const active = tasks.filter(
    (t) => !["completed", "cancelled"].includes(t.status),
  );
  const goals = data.goals.filter(
    (g) => g.area_id === area.id && g.status === "active",
  );
  return (
    <>
      <div className="page-heading">
        <div
          className={`area-workspace-header no-margin area-band area-paper area-${
            slug === "academics"
              ? "school"
              : slug === "career"
                ? "career"
                : slug === "basketball"
                  ? "ball"
                  : "other"
          }`}
        >
          <span className="section-icon area-icon">
            <Icon />
          </span>
          <div>
            <h1 className="area-heading">
              {slug === "academics" ? "School" : area.name}
            </h1>
          </div>
        </div>
        {slug === "projects" && (
          <Button onClick={() => setEditor({ kind: "projects" })}>
            <Plus size={14} />
            New project
          </Button>
        )}
      </div>

      {slug === "projects" && (
        <label className="project-search">
          Find a project
          <input
            type="search"
            placeholder="Search projects…"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
          />
        </label>
      )}
      {!["academics", "career"].includes(slug) && (
        <div className="area-metrics">
          <div className="area-summary">
            Active tasks<strong>{active.length}</strong>
          </div>
          <div className="area-summary">
            Active goals<strong>{goals.length}</strong>
          </div>
          <div className="area-summary">
            Completed tasks
            <strong>
              {tasks.filter((t) => t.status === "completed").length}
            </strong>
          </div>
        </div>
      )}
      {!["academics", "career"].includes(slug) && (
        <div className="tabs">
          {["overview", "tasks"].map((t) => (
            <button
              className={`tab ${tab === t ? "active" : ""}`}
              key={t}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}
      {tab === "tasks" ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>{area.name} tasks</h2>
          </div>
          {tasks.length ? (
            <TaskList tasks={tasks} />
          ) : (
            <EmptyState
              title="No tasks here yet"
              description="Add a task below."
            />
          )}
          <QuickCapture areaId={area.id} />
        </section>
      ) : (
        <>
          {slug === "projects" ? (
            <>
              <ProjectCards
                projects={projects.filter(
                  (p) => p.status !== "completed" && p.status !== "cancelled",
                )}
                onEdit={setEditor}
              />
              {projects.some((p) =>
                ["completed", "cancelled"].includes(p.status),
              ) && (
                <details className="panel collection-disclosure">
                  <summary>
                    Completed and cancelled projects (
                    {
                      projects.filter((p) =>
                        ["completed", "cancelled"].includes(p.status),
                      ).length
                    }
                    )
                  </summary>
                  <ProjectCards
                    projects={projects.filter((p) =>
                      ["completed", "cancelled"].includes(p.status),
                    )}
                    onEdit={setEditor}
                  />
                </details>
              )}
              <ProjectRecovery
                projects={data.projects.filter(
                  (p) =>
                    (!!p.archived_at || !!p.deleted_at) &&
                    (slug === "projects" || p.area_id === area.id),
                )}
              />
              {!projects.length && (
                <section className="panel">
                  <EmptyState
                    icon={Layers3}
                    title="No projects yet"
                    description="Add a project to keep its tasks and milestones together."
                    action={
                      <Button onClick={() => setEditor({ kind: "projects" })}>
                        <Plus size={13} />
                        Create project
                      </Button>
                    }
                  />
                </section>
              )}
            </>
          ) : (
            <div
              className={
                slug === "academics" ? "course-layout" : "dashboard-grid"
              }
            >
              {slug === "academics" ? (
                <AcademicsPanel
                  key={`${initialCourse ?? "all"}:${initialAssessment ?? ""}:${initialView ?? ""}`}
                  initialView={initialView}
                  initialCourse={initialCourse}
                  initialAssessment={initialAssessment}
                />
              ) : slug === "career" ? (
                <CareerWorkspace />
              ) : (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      {slug === "academics"
                        ? "Academic records"
                        : slug === "career"
                          ? "Career development"
                          : slug === "finances"
                            ? "Optional finance area"
                            : "Optional wellbeing area"}
                    </h2>
                    <span className="badge">
                      {["finances", "wellbeing"].includes(slug)
                        ? "Optional"
                        : "No imports"}
                    </span>
                  </div>
                  <EmptyState
                    icon={Icon}
                    title={
                      slug === "academics"
                        ? "Verified information first"
                        : slug === "career"
                          ? "Build from your actual experience"
                          : slug === "finances"
                            ? "A fresh financial picture"
                            : "Your space, your pace"
                    }
                    description={
                      slug === "academics"
                        ? "No courses, assessments, grades, or deadlines have been imported. Specialized academic records are a later phase."
                        : slug === "career"
                          ? "Connect your career plans, projects and professional relationships."
                          : slug === "finances"
                            ? "Keep money-related tasks here. Financial tracking is not set up yet."
                            : "Make room for your routines and personal priorities."
                    }
                  />
                </section>
              )}
              {slug !== "academics" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Next actions</h2>
                    <span className="count-pill">{active.length}</span>
                  </div>
                  {active.length ? (
                    <TaskList tasks={active.slice(0, 5)} />
                  ) : (
                    <EmptyState
                      compact
                      title="No active actions"
                      description="Add only what is useful to you."
                    />
                  )}
                  <QuickCapture areaId={area.id} />
                </section>
              )}
            </div>
          )}
          {slug === "career" && projects.length > 0 && (
            <section className="td-card career-projects" aria-label="Projects">
              <div className="td-card-head">
                <h2 className="td-card-title">Projects</h2>
                <Link className="td-link" href="/areas/projects">
                  Open Projects
                </Link>
              </div>
              <ul>
                {projects
                  .filter(
                    (p) => p.status !== "completed" && p.status !== "cancelled",
                  )
                  .map((p) => (
                    <li key={p.id}>
                      <Link href={`/areas/projects#project-${p.id}`}>
                        <span>{p.name}</span>
                        <span className="td-muted">
                          {p.target_date
                            ? `Due ${dayLabel(p.target_date)}`
                            : "No due date"}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          {slug !== "projects" && slug !== "career" && projects.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <ProjectCards
                projects={projects.filter(
                  (p) => p.status !== "completed" && p.status !== "cancelled",
                )}
                onEdit={setEditor}
              />
              {projects.some((p) =>
                ["completed", "cancelled"].includes(p.status),
              ) && (
                <details className="panel collection-disclosure">
                  <summary>
                    Completed and cancelled projects (
                    {
                      projects.filter((p) =>
                        ["completed", "cancelled"].includes(p.status),
                      ).length
                    }
                    )
                  </summary>
                  <ProjectCards
                    projects={projects.filter((p) =>
                      ["completed", "cancelled"].includes(p.status),
                    )}
                    onEdit={setEditor}
                  />
                </details>
              )}
              <ProjectRecovery
                projects={data.projects.filter(
                  (p) =>
                    (!!p.archived_at || !!p.deleted_at) &&
                    (slug === "projects" || p.area_id === area.id),
                )}
              />
            </div>
          )}
        </>
      )}
      {editor && (
        <EntityEditor state={editor} onClose={() => setEditor(null)} />
      )}
    </>
  );
}
export function ProjectCards({
  projects,
  onEdit,
}: {
  projects: ReturnType<typeof useWorkspace>["data"]["projects"];
  onEdit: (state: EntityEditorState) => void;
}) {
  const { data: raw } = useWorkspace();
  const data = realWorkspace(raw);
  return (
    <div className="cards-grid">
      {projects.map((p) => {
        const tasks = data.tasks.filter(
          (t) =>
            t.project_id === p.id && !t.deleted_at && t.status !== "cancelled",
        );
        const done = tasks.filter((t) => t.status === "completed").length;
        const milestones = data.milestones.filter((m) => m.project_id === p.id);
        return (
          <article className="entity-card" key={p.id} id={`project-${p.id}`}>
            <div className="flex-between full-width">
              <span className={`badge ${p.status === "active" ? "blue" : ""}`}>
                {p.status === "planned" ? "Not started" : p.status}
              </span>
            </div>
            <button
              className="task-main"
              onClick={() => onEdit({ kind: "projects", record: p })}
            >
              <h2>{p.name}</h2>
            </button>
            <p className="project-summary">
              {projectSummary(p.name, p.description, !!p.source_id)}
            </p>
            <div className="full-width">
              <div className="flex-between small muted">
                <span>
                  {tasks.length
                    ? `${done} of ${tasks.length} tasks complete`
                    : "No tasks"}
                </span>
              </div>
              {tasks.length > 0 && (
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${(done / tasks.length) * 100}%` }}
                  />
                </div>
              )}
            </div>
            <details className="project-milestones">
              <summary>Tasks & milestones</summary>
              <TaskList tasks={tasks} />
              {milestones.map((m) => (
                <button
                  className="task-main"
                  key={m.id}
                  onClick={() => onEdit({ kind: "milestones", record: m })}
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
            </details>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit({ kind: "milestones", projectId: p.id })}
            >
              <Plus size={12} />
              Add milestone
            </Button>
            <div className="card-footer">
              <span>
                {p.target_date
                  ? `Due ${friendlyDate(p.target_date)}`
                  : `Updated ${friendlyDate(p.updated_at)}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit({ kind: "projects", record: p })}
              >
                Edit
                <ArrowUpRight size={12} />
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ProjectRecovery({
  projects,
}: {
  projects: ReturnType<typeof useWorkspace>["data"]["projects"];
}) {
  const { request, refresh, notify } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!projects.length) return null;
  return (
    <details className="panel collection-disclosure">
      <summary>Archived & recently deleted ({projects.length})</summary>
      <p className="small muted">
        Your linked work and history are preserved. Restoring keeps automatic
        scheduling off.
      </p>
      {projects.map((p) => (
        <div className="setting-line" key={p.id}>
          <div>
            <strong>{p.name}</strong>
            <p className="small muted">
              {p.deleted_at ? "Recently deleted" : "Archived"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await request(`/api/v1/projects/${p.id}/lifecycle`, {
                  method: "POST",
                  body: JSON.stringify({
                    action: "restore",
                    version: p.version,
                  }),
                });
                await refresh();
                notify("Project restored");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Unable to restore");
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore {p.name}
          </Button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
