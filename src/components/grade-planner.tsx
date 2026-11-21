"use client";
import { useState } from "react";
import type { AcademicRow } from "./academic-editor";
import type { GradeAssessment, GradeCategory } from "@/lib/academic-grades";
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
                  <td>{assessmentResult(a)}</td>
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
