"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Download, Search } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { realWorkspace } from "@/lib/real-workspace";
import { availableProject } from "@/lib/visible-areas";
import { calendarRequest } from "./use-calendar";
import type { SavedPlans } from "@/lib/services/saved-plans";
import type { AcademicData } from "./academic-editor";
import { GoogleCalendarPanel } from "./google-calendar-panel";
import { Button } from "./ui/button";
import { TaskList } from "./task-list";
import {
  shootingColumns,
  shootingReport,
  reportCsv,
} from "@/lib/shooting-report";
function useSavedPlans() {
  const [data, setData] = useState<SavedPlans | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () => {
      void calendarRequest<SavedPlans>("/api/v1/sheets/tables?overview=true")
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch(() => {
          if (live) setError("Connected records couldn’t load.");
        });
    };
    load();
    window.addEventListener("lifeos:changed", load);
    return () => {
      live = false;
      window.removeEventListener("lifeos:changed", load);
    };
  }, []);
  return { data, error };
}
export function BasketballPage() {
  const { data: raw } = useWorkspace(),
    data = realWorkspace(raw),
    saved = useSavedPlans();
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<"player" | "accuracy">("player");
  const projects = data.projects.filter(
    (p) =>
      availableProject(p) &&
      /\b(basketball|shooting|hoops|mbb)\b/i.test(p.name + " " + p.description),
  );
  const ids = new Set(projects.map((p) => p.id));
  const tasks = data.tasks.filter(
    (t) =>
      !t.deleted_at &&
      ((!!t.project_id && ids.has(t.project_id)) ||
        /\b(basketball|shooting|mbb)\b/i.test(t.title)),
  );
  const reports = saved.data?.datasets.filter((d) => shootingColumns(d)) ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>Basketball Ops</h1>
        <Button variant="outline" asChild>
          <Link href="/planner">
            Open planner <ArrowUpRight size={14} />
          </Link>
        </Button>
      </div>
      <div className="workspace-columns">
        <div>
          <section>
            <div className="panel-heading">
              <h2>Operational work</h2>
              <Link className="text-link" href="/areas/career">
                Career
              </Link>
            </div>
            {tasks.length ? (
              <TaskList tasks={tasks} />
            ) : (
              <p className="muted">No operational tasks.</p>
            )}
          </section>
          <section className="workspace-section">
            <h2>Projects & reports</h2>
            <div className="work-list">
              {projects.map((p) => (
                <Link
                  className="work-list-row"
                  href={`/areas/career#project-${p.id}`}
                  key={p.id}
                >
                  <div>
                    <h2>{p.name}</h2>
                    <p>
                      {
                        data.tasks.filter(
                          (t) =>
                            t.project_id === p.id &&
                            !t.deleted_at &&
                            !["completed", "cancelled"].includes(t.status),
                        ).length
                      }{" "}
                      open tasks
                    </p>
                  </div>
                  <span className="small muted">
                    {p.status === "planned"
                      ? "Not started"
                      : p.status.replaceAll("_", " ")}
                  </span>
                </Link>
              ))}
              {!projects.length && (
                <p className="muted">No basketball projects yet.</p>
              )}
            </div>
          </section>
        </div>
        <aside>
          <GoogleCalendarPanel
            heading="Team schedule"
            calendarPattern="basketball|MBB"
          />
          <section>
            <h2>Source records</h2>
            <p className="small muted" style={{ marginTop: 12 }}>
              Shooting data appears here when a connected table includes player
              names, makes and attempts.
            </p>
            <Link className="text-link" href="/settings?section=integrations">
              Manage connections <ArrowUpRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
      <section className="workspace-section" id="shooting-report">
        <div className="panel-heading">
          <h2>Shooting reports</h2>
          {reports.length > 0 && (
            <label className="search-trigger">
              <Search size={15} />
              <input
                aria-label="Find a player"
                placeholder="Find a player…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
        </div>
        {saved.error && (
          <p role="alert" className="error-message">
            {saved.error}
          </p>
        )}
        {!saved.data && !saved.error && (
          <p className="muted">Loading reports…</p>
        )}
        {saved.data && !reports.length && (
          <p className="muted">No shooting report connected.</p>
        )}
        {reports.map((d) => {
          const section = saved.data!.overview.find(
            (o) => o.dataset_id === d.id,
          );
          if (section?.error)
            return (
              <p key={d.id} role="alert">
                {d.title} couldn’t load.
              </p>
            );
          const report = shootingReport(d, section?.rows ?? []);
          if (!report) return null;
          const shown = report.items
            .filter((r) => r.player.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) =>
              sort === "player"
                ? a.player.localeCompare(b.player)
                : (b.accuracy ?? -1) - (a.accuracy ?? -1),
            );
          return (
            <section className="workspace-section" key={d.id}>
              <div className="panel-heading">
                <h3>{d.title}</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!report.valid || !!section?.more}
                  onClick={() => {
                    const blob = new Blob([reportCsv(report.items)], {
                      type: "text/csv;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "shooting-report.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download /> Export CSV
                </Button>
              </div>
              {report.valid && (
                <p className="small muted">
                  {section?.more ? "Preview: " : ""}
                  {report.made} made / {report.attempts} attempts
                  {report.accuracy !== null
                    ? ` · ${report.accuracy.toFixed(1)}%`
                    : ""}
                </p>
              )}
              {section?.more && (
                <p className="small muted">
                  More rows are available in the source. Export is disabled for
                  this partial preview.
                </p>
              )}
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Shooting results"
              >
                <table>
                  <thead>
                    <tr>
                      <th>
                        <button onClick={() => setSort("player")}>
                          Player
                        </button>
                      </th>
                      <th>Made</th>
                      <th>Attempts</th>
                      <th>
                        <button onClick={() => setSort("accuracy")}>
                          Accuracy
                        </button>
                      </th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!shown.length && (
                      <tr>
                        <td colSpan={5}>
                          {report.items.length
                            ? "No matching players."
                            : "No player results yet."}
                        </td>
                      </tr>
                    )}
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td>{r.player}</td>
                        <td>{r.made ?? "—"}</td>
                        <td>{r.attempts ?? "—"}</td>
                        <td>
                          {r.accuracy === null
                            ? "—"
                            : r.accuracy.toFixed(1) + "%"}
                        </td>
                        <td>{r.issue ?? "Checked"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </section>
    </>
  );
}
export function LearningPage() {
  const saved = useSavedPlans(),
    [academic, setAcademic] = useState<AcademicData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void calendarRequest<AcademicData>("/api/v1/academics")
      .then((d) => {
        if (live) setAcademic(d);
      })
      .catch(() => {
        if (live) setError("Study topics couldn’t load.");
      });
    return () => {
      live = false;
    };
  }, []);
  const skills =
    saved.data?.datasets.filter((d) =>
      d.config.columns.some((c) => /^skill$/i.test(c.header)),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>Learning</h1>
        <Button variant="outline" asChild>
          <Link href="/areas/academics?view=study">
            Study workspace <ArrowUpRight size={14} />
          </Link>
        </Button>
      </div>
      <section>
        <div className="panel-heading">
          <h2>Learning paths</h2>
        </div>
        {saved.error && <p role="alert">{saved.error}</p>}
        {!saved.data && !saved.error && (
          <p className="muted">Loading learning paths…</p>
        )}
        <div className="learning-list">
          {skills.flatMap((d) => {
            const section = saved.data!.overview.find(
              (o) => o.dataset_id === d.id,
            );
            if (section?.error)
              return [
                <p role="alert" key={d.id}>
                  Skill records couldn’t load.
                </p>,
              ];
            const title = d.config.columns.find((c) =>
                /^skill$/i.test(c.header),
              )!,
              level = d.config.columns.find((c) =>
                /^(current level|status)$/i.test(c.header),
              ),
              rhythm = d.config.columns.find((c) =>
                /^practice rhythm$/i.test(c.header),
              );
            return (section?.rows ?? [])
              .filter((r) => r.state !== "deleted")
              .map((r) => (
                <div className="learning-row" key={r.id}>
                  <div>
                    <h2>
                      {String(r.local_values[title.key] ?? "Unnamed skill")}
                    </h2>
                    {rhythm && r.local_values[rhythm.key] ? (
                      <p>{String(r.local_values[rhythm.key])}</p>
                    ) : null}
                    <Link
                      className="text-link"
                      href="/areas/career#connected-roadmap"
                    >
                      View learning plan <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  {level && (
                    <span className="small muted">
                      {String(r.local_values[level.key] ?? "Not recorded")}
                    </span>
                  )}
                </div>
              ));
          })}
        </div>
        {saved.data && !skills.length && (
          <p className="muted">No learning paths connected.</p>
        )}
      </section>
      <section className="workspace-section">
        <div className="panel-heading">
          <h2>Study topics</h2>
          <Link className="text-link" href="/areas/academics?view=study">
            All topics
          </Link>
        </div>
        {error && <p role="alert">{error}</p>}
        {academic?.study_topics.map((t) => (
          <Link
            className="learning-row"
            key={t.id}
            href={`/areas/academics?course=${t.course_id}&view=study`}
          >
            <div>
              <h2>{String(t.title)}</h2>
              <p>
                {String(
                  academic.courses.find((c) => c.id === t.course_id)?.code ??
                    "",
                )}
              </p>
            </div>
            <span className="small muted">
              {String(t.mastery ?? "not_started").replaceAll("_", " ")}
            </span>
          </Link>
        ))}
        {academic && !academic.study_topics.length && (
          <p className="muted">No study topics yet.</p>
        )}
      </section>
    </>
  );
}
