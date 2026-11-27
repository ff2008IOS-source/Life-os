"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";
import type { AcademicData } from "./academic-editor";
import {
  academicGrade,
  gradeParts,
  type GradeAssessment,
  type GradeCategory,
} from "@/lib/academic-grades";
import { GradeRing } from "./living";
import {
  standingLabel,
  possibleAssessmentDuplicates,
} from "@/lib/academic-display";
export function AcademicProgressSummary({
  provided,
}: { provided?: AcademicData } = {}) {
  const [loaded, setData] = useState<AcademicData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (provided) return;
    let live = true;
    void calendarRequest<AcademicData>("/api/v1/academics")
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live) setError("Academic progress could not refresh.");
      });
    return () => {
      live = false;
    };
  }, [provided]);
  const data = provided ?? loaded;
  if (error) return <p role="alert">{error}</p>;
  if (!data?.courses.length) return null;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Your academic standing</h2>
        <span className="small muted">Latest recorded results</span>
      </div>
      <div className="academic-standing-cards">
        {data.courses.map((course) => {
          const rows = data.assessments.filter(
            (a) => a.course_id === course.id,
          );
          if (!rows.length) return null;
          const summary = academicGrade(
            String(course.grading_method),
            rows as unknown as GradeAssessment[],
            data.grading_categories.filter(
              (c) => c.course_id === course.id,
            ) as unknown as GradeCategory[],
            {
              inventoryComplete: course.inventory_confirmed === true,
              rulesVerified: course.grading_rules_confirmed === true,
            },
          );
          const standing = standingLabel(
            summary,
            course.grading_rules_confirmed === true &&
              possibleAssessmentDuplicates(rows).length === 0 &&
              rows
                .filter((a) => !a.dropped && typeof a.earned_score === "number")
                .every((a) =>
                  ["verified", "user_confirmed"].includes(
                    String(a.verification_status),
                  ),
                ),
          );
          const parts =
            course.grading_rules_confirmed === true &&
            String(course.grading_method) !== "unknown"
              ? gradeParts(
                  String(course.grading_method),
                  rows as unknown as (GradeAssessment & { title?: string })[],
                  data.grading_categories.filter(
                    (c) => c.course_id === course.id,
                  ) as unknown as (GradeCategory & { name?: string })[],
                )
              : [];
          return (
            <Link
              href={`/areas/academics?course=${course.id}`}
              className="standing-card"
              key={course.id}
            >
              <h3>{String(course.code)}</h3>
              {parts.length > 0 ? (
                <GradeRing parts={parts} value={standing.value} size={96} />
              ) : (
                <strong>{standing.value}</strong>
              )}
              <span>{standing.title}</span>
              <small>{summary.missing_scores} results pending</small>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
