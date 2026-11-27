"use client";
import { useState } from "react";
import type { AcademicRow } from "./academic-editor";
import {
  awaitingMark,
  gradeParts,
  type GradeAssessment,
  type GradeCategory,
} from "@/lib/academic-grades";
import { assessmentResult } from "@/lib/academic-display";
import { gradeScenario } from "@/lib/grade-scenario";
import { Button } from "./ui/button";
export function GradePlanner({
  course,
  assessments,
  categories,
  onRules,
}: {
  course: AcademicRow;
  assessments: AcademicRow[];
  categories: AcademicRow[];
  onRules: () => void;
}) {
  const [target, setTarget] = useState("80");
  const rulesOk =
    course.grading_rules_confirmed === true &&
    String(course.grading_method) !== "unknown";
  const parts = rulesOk
    ? gradeParts(
        String(course.grading_method),
        assessments as unknown as (GradeAssessment & { title?: string })[],
        categories as unknown as (GradeCategory & { name?: string })[],
      )
    : [];
  const scenario = gradeScenario(
    String(course.grading_method),
    assessments as unknown as GradeAssessment[],
    categories as unknown as GradeCategory[],
    target.trim() ? Number(target) : NaN,
    {
      inventoryComplete: course.inventory_confirmed === true,
      rulesVerified: course.grading_rules_confirmed === true,
    },
  );
  return (
    <section>
      <div className="panel-heading">
        <h2>Grades</h2>
        <Button variant="outline" size="sm" onClick={onRules}>
          Grading rules
        </Button>
      </div>
      {rulesOk && parts.length > 0 && (
        <figure
          className="weight-bar"
          aria-label="The course by syllabus weight"
        >
          <div className="weight-track">
            {parts.map((p, i) => (
              <span
                key={i}
                className={p.score === null ? "open" : ""}
                style={{ flexGrow: p.weight }}
                title={`${p.label} · ${p.weight}%${p.score === null ? " · not marked yet" : ` · ${Math.round(p.score * 1000) / 10}%`}`}
              >
                {p.score !== null && (
                  <i
                    className={tone(p.score * 100)}
                    style={{ width: `${p.score * 100}%` }}
                  />
                )}
                <b>
                  {p.label} · {p.weight}%
                </b>
              </span>
            ))}
          </div>
          <figcaption className="small muted">
            The whole course, split by syllabus weight. Filled parts are marked;
            striped parts are still to come.
          </figcaption>
        </figure>
      )}
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Assessment grades"
      >
        <table>
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Result</th>
              <th>Listed weight</th>
            </tr>
          </thead>
          <tbody>
            {assessments
              .filter((a) => !a.dropped)
              .map((a) => (
                <tr key={a.id}>
                  <td>{String(a.title)}</td>
                  <td>
                    <ResultMeter a={a} />
                  </td>
                  <td>{typeof a.weight === "number" ? `${a.weight}%` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!assessments.length && <p className="muted">No assessments yet.</p>}
      <div className="grade-planner">
        <h3>Target scenario</h3>
        <p className="small muted">
          A projection based on confirmed grading rules, not a recorded grade.
        </p>
        <label>
          Target (%)
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            min="0"
            max="100"
            step="1"
          />
        </label>
        <output aria-live="polite">
          {scenario.status === "required"
            ? `Score approximately ${scenario.percent.toFixed(1)}% on each of the ${scenario.remaining} remaining assessments.`
            : scenario.status === "unreachable"
              ? `The highest possible result in this scenario is ${scenario.maximum.toFixed(1)}%.`
              : scenario.status === "complete"
                ? "All assessment results are recorded."
                : scenario.status === "invalid"
                  ? "Enter a target from 0 to 100%."
                  : "Confirm the assessment inventory and grading rules to calculate a scenario."}
        </output>
      </div>
    </section>
  );
}

const tone = (pct: number) => (pct >= 80 ? "good" : pct >= 65 ? "ok" : "low");

/** A result with a small meter; a Canvas placeholder 0 reads as awaiting. */
function ResultMeter({ a }: { a: AcademicRow }) {
  const earned = a.earned_score as number | null;
  const max = a.maximum_score as number | null;
  const placeholder = awaitingMark({
    earned_score: earned,
    submission_state: String(a.submission_state ?? ""),
  });
  if (placeholder || a.submission_state === "submitted")
    return (
      <span className="result-meter">
        <span className="meter wait" aria-hidden />
        <span>Awaiting grade</span>
      </span>
    );
  if (typeof earned === "number" && typeof max === "number" && max > 0) {
    const pct = (earned / max) * 100;
    return (
      <span className="result-meter">
        <span className="meter" aria-hidden>
          <i
            className={tone(pct)}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </span>
        <span>{assessmentResult(a)}</span>
      </span>
    );
  }
  return (
    <span className="result-meter">
      <span className="meter" aria-hidden />
      <span>{assessmentResult(a)}</span>
    </span>
  );
}
