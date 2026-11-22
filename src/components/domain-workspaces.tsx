"use client";
import { affects } from "@/lib/workspace-change";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import type { SavedPlans } from "@/lib/services/saved-plans";
import type { AcademicData } from "./academic-editor";
import { Button } from "./ui/button";
function useSavedPlans() {
  const [data, setData] = useState<SavedPlans | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = (event?: Event) => {
      if (event && !affects(event, ["sheets"])) return;
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
        {saved.error && (
          <p role="alert">
            {saved.error}{" "}
            <Link href="/settings?section=integrations">Check connections</Link>
          </p>
        )}
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
          <p className="muted">
            No learning paths connected.{" "}
            <Link href="/settings?section=integrations">
              Connect a learning plan
            </Link>{" "}
            or <Link href="/areas/academics?view=study">add study topics</Link>.
          </p>
        )}
      </section>
      <section className="workspace-section">
        <div className="panel-heading">
          <h2>Study topics</h2>
          <Link className="text-link" href="/areas/academics?view=study">
            All topics
          </Link>
        </div>
        {error && (
          <p role="alert">
            {error}{" "}
            <Link href="/areas/academics?view=study">Open study workspace</Link>
          </p>
        )}
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
