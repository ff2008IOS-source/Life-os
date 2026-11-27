"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { useCareer } from "./career-workspace";
import type { AcademicData } from "./academic-editor";
import { Button } from "./ui/button";
export function LearningPage() {
  const career = useCareer(),
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
  const skills = (career.data?.entries ?? []).filter((e) => e.kind === "skill");
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
        {career.error && <p role="alert">{career.error}</p>}
        {!career.data && !career.error && (
          <p className="muted">Loading learning paths…</p>
        )}
        <div className="learning-list">
          {skills.map((s) => (
            <div className="learning-row" key={s.id}>
              <div>
                <h2>{s.title}</h2>
                {s.details.rhythm ? <p>{String(s.details.rhythm)}</p> : null}
                <Link className="text-link" href="/areas/career">
                  View in Career <ArrowUpRight size={14} />
                </Link>
              </div>
              <span className="small muted">
                {String(s.details.level ?? s.status)}
              </span>
            </div>
          ))}
        </div>
        {career.data && !skills.length && (
          <p className="muted">
            No skills yet. <Link href="/areas/career">Add one in Career</Link>{" "}
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
