"use client";
import { useEffect, useMemo, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { useWorkspace } from "./workspace-provider";
import type { AcademicData } from "./academic-editor";
import { weekRecap, type WeekRecap } from "@/lib/week-recap";
import { Mark } from "./mark";

export function useWeekRecap(weekStart: string, weekEnd: string) {
  const { data } = useWorkspace();
  const [academics, setAcademics] = useState<AcademicData | null>(null);
  useEffect(() => {
    let live = true;
    calendarRequest<AcademicData>("/api/v1/academics")
      .then((d) => live && setAcademics(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return useMemo(
    () =>
      weekRecap({
        weekStart,
        weekEnd,
        tasks: data.tasks,
        goals: data.goals,
        milestones: data.milestones,
        goalTasks: data.goalTasks,
        courses: academics?.courses ?? [],
        assessments: academics?.assessments ?? [],
        topics: academics?.study_topics ?? [],
        sessions: academics?.study_sessions ?? [],
      }),
    [data, academics, weekStart, weekEnd],
  );
}

/** What this week actually held, filled in from recorded work. */
export function WeekRecapCard({
  recap,
  title = "This week",
}: {
  recap: WeekRecap;
  title?: string;
}) {
  const stats = [
    {
      label: "Deadlines handled",
      value: recap.deadlines.total
        ? `${recap.deadlines.handled} of ${recap.deadlines.total}`
        : "—",
    },
    { label: "Tasks finished", value: String(recap.tasksDone.length) },
    { label: "Goals moved", value: String(recap.goalsMoved.length) },
    {
      label: "Study logged",
      value: recap.studyMinutes
        ? `${recap.studyMinutes} min`
        : recap.studySessions
          ? `${recap.studySessions} sessions`
          : "—",
    },
  ];
  return (
    <section className="panel settings-panel recap" aria-label="Week recap">
      <h2>{title}</h2>
      <div className="recap-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      {recap.marks.length > 0 && (
        <div className="recap-block">
          <h3>Marks back</h3>
          <ul>
            {recap.marks.map((m) => (
              <li key={m.course + m.title}>
                <span>
                  {m.course} · {m.title}
                </span>
                <Mark earned={m.percent} unit="percent" showFraction={false} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {recap.deadlines.missed.length > 0 && (
        <div className="recap-block">
          <h3>Not marked as handed in</h3>
          <ul>
            {recap.deadlines.missed.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {(recap.goalsMoved.length > 0 || recap.milestones.length > 0) && (
        <div className="recap-block">
          <h3>Goals</h3>
          <ul>
            {recap.milestones.map((t) => (
              <li key={"m" + t}>Milestone reached: {t}</li>
            ))}
            {recap.goalsMoved.map((t) => (
              <li key={"g" + t}>Moved forward: {t}</li>
            ))}
          </ul>
        </div>
      )}
      {recap.topicsImproved.length > 0 && (
        <div className="recap-block">
          <h3>Topics improved</h3>
          <ul>
            {recap.topicsImproved.slice(0, 6).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
