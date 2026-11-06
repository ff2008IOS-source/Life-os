import { randomUUID } from "node:crypto";
import type { SheetSnapshot } from "./sheets-server";
import { academicSchemas } from "@/lib/academic-schemas";
type Existing = {
  terms: { id: string; name: string }[];
  courses: { id: string; term_id: string; code: string }[];
  assessments: { id: string; course_id: string; title: string }[];
  topics: { id: string; course_id: string; title: string }[];
};
function table(snapshot: SheetSnapshot, name: string, required: string[]) {
  const tab = snapshot.tabs.find((t) => t.title === name);
  if (!tab) throw Error(`Missing source tab: ${name}`);
  const headers = (tab.values[3] ?? []).map((v) => String(v ?? "").trim());
  if (required.some((h) => !headers.includes(h)))
    throw Error(`Headers changed in ${name}; verify mapping first.`);
  return {
    id: tab.id,
    rows: tab.values
      .slice(4)
      .map((row) =>
        Object.fromEntries(
          headers.map((key, i) => [key, row[i] == null ? "" : String(row[i])]),
        ),
      ),
  };
}
function percent(value: string) {
  if (!value.trim()) return null;
  const n = Number(value.replace("%", "").replaceAll(",", "").trim());
  if (!Number.isFinite(n) || n < 0) throw Error("Invalid source score/weight.");
  return n;
}
export function mapAcademicSnapshot(
  snapshot: SheetSnapshot,
  existing: Existing,
) {
  const source = table(snapshot, "Course Command Centre", [
    "Course",
    "Term",
    "Notes",
  ]);
  const marks = table(snapshot, "Assessments & Grades", [
    "Course",
    "Assessment",
    "Semester",
    "Weight %",
    "Score %",
    "Notes",
  ]);
  const knowledge = table(snapshot, "Knowledge Mastery", [
    "Course",
    "Topic / Concept",
    "Status",
  ]);
  const terms = new Map(existing.terms.map((t) => [t.name, t]));
  const newTerms = [];
  const courses = [];
  const assessments = [];
  const topics = [];
  const courseMap = new Map<string, string>();
  const aliases = new Map<string, string>();
  const seen = new Set<string>();
  const identity = (tab: number, ...values: string[]) => {
    const key = JSON.stringify([snapshot.id, tab, ...values]);
    if (seen.has(key))
      throw Error("Duplicate source identity; review repeated source rows.");
    seen.add(key);
    return key;
  };
  for (const row of source.rows) {
    if (!row.Course.trim()) continue;
    const termName = row.Term.trim();
    if (!termName) throw Error("A course has no academic term.");
    let term = terms.get(termName);
    if (!term) {
      term = { id: randomUUID(), name: termName };
      terms.set(termName, term);
      newTerms.push({ ...term, start_date: null, end_date: null });
    }
    const code =
      row.Course.trim() === "PHIL 100" && row.Notes.includes("PHIL 100W")
        ? "PHIL 100W"
        : row.Course.trim();
    aliases.set(row.Course.trim(), code);
    const id =
      existing.courses.find((c) => c.term_id === term!.id && c.code === code)
        ?.id ?? randomUUID();
    const parsed = academicSchemas.courses.parse({
      term_id: term.id,
      code,
      title: code,
      description: row.Notes,
      grading_method: "unknown",
      verification_status: "unverified",
    });
    courses.push({
      id,
      ...parsed,
      source_key: identity(source.id, termName, code),
    });
    courseMap.set(termName + "|" + row.Course.trim(), id);
  }
  for (const row of marks.rows) {
    if (!row.Course.trim() || !row.Assessment.trim()) continue;
    const course = courseMap.get(row.Semester.trim() + "|" + row.Course.trim());
    if (!course)
      throw Error(`An assessment has no matching term/course: ${row.Course}.`);
    const score = percent(row["Score %"]);
    const due = row["Due Date"]?.trim() || null;
    const parsed = academicSchemas.assessments.parse({
      course_id: course,
      title: row.Assessment.trim(),
      weight: percent(row["Weight %"]),
      maximum_score: score === null ? null : 100,
      earned_score: score,
      score_unit: "percent",
      submission_state: "unknown",
      due_date: due,
      verification_status: "unverified",
      source_status: row.Status || null,
      notes: row.Notes ?? "",
    });
    const id =
      existing.assessments.find(
        (a) => a.course_id === course && a.title === parsed.title,
      )?.id ?? randomUUID();
    assessments.push({
      id,
      ...parsed,
      source_key: identity(
        marks.id,
        row.Semester.trim(),
        row.Course.trim(),
        row.Assessment.trim(),
      ),
    });
  }
  for (const row of knowledge.rows) {
    if (!row.Course.trim() || !row["Topic / Concept"].trim()) continue;
    const matches = courses.filter(
      (c) => c.code === (aliases.get(row.Course.trim()) ?? row.Course.trim()),
    );
    if (matches.length !== 1)
      throw Error(
        "Study-topic term is ambiguous. Assign a term before importing.",
      );
    const course = matches[0].id;
    const mastery =
      row.Status === "Not Learned"
        ? "unstudied"
        : row.Confidence === "Low" || row["Retrieval Result"] === "Missed"
          ? "needs_review"
          : "practicing";
    const parsed = academicSchemas.study_topics.parse({
      course_id: course,
      title: row["Topic / Concept"].trim(),
      mastery,
      notes: Object.entries(row)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    });
    const id =
      existing.topics.find(
        (t) => t.course_id === course && t.title === parsed.title,
      )?.id ?? randomUUID();
    topics.push({
      id,
      ...parsed,
      source_key: identity(knowledge.id, course, parsed.title),
    });
  }
  return {
    terms: newTerms,
    courses,
    assessments,
    topics,
    warning:
      "Dates and grades are source-reported, not independently verified. Percentage scores use a labelled /100 percentage scale. Course grading formulas remain unconfirmed. No tasks are created and existing records are kept unchanged.",
  };
}
