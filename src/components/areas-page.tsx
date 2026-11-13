"use client";
import Link from "next/link";
import { ConnectedCareerRecords } from "./connected-career-records";
import { AcademicsPanel } from "./academics-panel";
import { projectSummary } from "@/lib/project-summary";
import { ContactsPanel } from "./contacts-panel";
import { CareerPanel } from "./career-panel";
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
  initialAssessment,
}: {
  slug?: string;
  initialCourse?: string;
  initialAssessment?: string;
}) {
  const { data } = useWorkspace();
  const [editor, setEditor] = useState<EntityEditorState | null>(null);
  const [tab, setTab] = useState("overview");
  const area = data.areas.find((a) => a.slug === slug);
  const projects = data.projects.filter(
    (p) =>
      !p.archived_at &&
      (!slug || p.area_id === area?.id || slug === "projects"),
  );
  if (!slug)
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">ROOM FOR EVERY PART OF LIFE</span>
            <h1>Your life areas</h1>
            <p>Different responsibilities. One connected workspace.</p>
          </div>
        </div>
        {!data.areas.length ? (
          <EmptyState
            icon={Layers3}
            title="Set up your life areas"
            description="Initialize your workspace from Home to create your five empty areas."
            action={
              <Button asChild variant="outline">
                <Link href="/">Go to Home</Link>
              </Button>
            }
          />
        ) : (
          <div className="cards-grid">
            {data.areas.map((a) => {
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
        <div className="area-workspace-header no-margin">
          <span
            className="section-icon"
            style={{ background: area.color + "15", color: area.color }}
          >
            <Icon />
          </span>
          <div>
            <h1>{area.name}</h1>
            <p>{descriptions[slug]}</p>
          </div>
        </div>
        {slug === "projects" && (
          <Button onClick={() => setEditor({ kind: "projects" })}>
            <Plus size={14} />
            New project
          </Button>
        )}
      </div>
      {slug === "projects" && <ConnectedCareerRecords />}
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
      <div className="tabs">
        {[
          "overview",
          "tasks",
          ...(slug === "projects" ? ["projects"] : []),
        ].map((t) => (
          <button
            className={`tab ${tab === t ? "active" : ""}`}
            key={t}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
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
              description="Capture an action below when you’re ready."
            />
          )}
          <QuickCapture areaId={area.id} />
        </section>
      ) : (
        <>
          {slug === "projects" ? (
            <>
              <ProjectCards projects={projects} onEdit={setEditor} />
              {!projects.length && (
                <section className="panel">
                  <EmptyState
                    icon={Layers3}
                    title="Give your next project a home"
                    description="Create confirmed projects when you’re ready. No project states have been assumed."
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
            <div className="dashboard-grid">
              {slug === "academics" ? (
                <AcademicsPanel
                  key={`${initialCourse ?? "all"}:${initialAssessment ?? ""}`}
                  initialCourse={initialCourse}
                  initialAssessment={initialAssessment}
                />
              ) : slug === "career" ? (
                <>
                  <ConnectedCareerRecords />
                  <details className="panel">
                    <summary>Earlier imported career archive</summary>
                    <CareerPanel />
                  </details>
                  <ContactsPanel />
                </>
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
            </div>
          )}
          {slug !== "projects" && projects.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <ProjectCards projects={projects} onEdit={setEditor} />
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
function ProjectCards({
  projects,
  onEdit,
}: {
  projects: ReturnType<typeof useWorkspace>["data"]["projects"];
  onEdit: (state: EntityEditorState) => void;
}) {
  const { data } = useWorkspace();
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
              <span className="section-icon">
                <Layers3 />
              </span>
              <span className={`badge ${p.status === "active" ? "blue" : ""}`}>
                {p.status}
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
                  {done} of {tasks.length} tasks complete
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit({ kind: "milestones", projectId: p.id })}
            >
              <Plus size={12} />
              Add milestone
            </Button>
            <div className="card-footer">
              <span>{friendlyDate(p.target_date)}</span>
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
