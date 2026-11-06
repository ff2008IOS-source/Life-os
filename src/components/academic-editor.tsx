"use client";
import { ZodError } from "zod";
import { useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Modal } from "./dialog";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import { academicSchemas } from "@/lib/academic-schemas";
export type AcademicRow = Record<string, unknown> & {
  id: string;
  version: number;
};
export type AcademicData = {
  academic_terms: AcademicRow[];
  courses: AcademicRow[];
  assessments: AcademicRow[];
  grading_categories: AcademicRow[];
  study_topics: AcademicRow[];
  study_sessions: AcademicRow[];
};
export type AcademicKind = keyof typeof academicSchemas;
type Field = {
  key: string;
  label: string;
  type?:
    "text" | "textarea" | "number" | "date" | "datetime-local" | "checkbox";
  required?: boolean;
  options?: [string, string][];
  table?: keyof AcademicData;
};
const definitions: Record<AcademicKind, Field[]> = {
  academic_terms: [
    { key: "name", label: "Term name", required: true },
    { key: "start_date", label: "Start date", type: "date" },
    { key: "end_date", label: "End date", type: "date" },
  ],
  courses: [
    {
      key: "term_id",
      label: "Academic term",
      table: "academic_terms",
      required: true,
    },
    { key: "code", label: "Course code", required: true },
    { key: "title", label: "Course title", required: true },
    { key: "description", label: "Notes", type: "textarea" },
    {
      key: "grading_method",
      label: "Grading formula",
      options: [
        ["unknown", "Not confirmed"],
        ["assessment_weights", "Individual assessment weights"],
        ["category_weights", "Weighted categories"],
        ["points", "Total points"],
      ],
    },
  ],
  assessments: [
    { key: "course_id", label: "Course", table: "courses", required: true },
    { key: "title", label: "Assessment title", required: true },
    {
      key: "category_id",
      label: "Grading category",
      table: "grading_categories",
    },
    {
      key: "score_unit",
      label: "Score scale",
      options: [
        ["points", "Original points"],
        ["percent", "Percentage scale"],
      ],
    },
    { key: "maximum_score", label: "Maximum score", type: "number" },
    {
      key: "earned_score",
      label: "Earned score (leave blank if unknown)",
      type: "number",
    },
    { key: "weight", label: "Course weight (%)", type: "number" },
    {
      key: "submission_state",
      label: "Submission state",
      options: [
        "unknown",
        "not_submitted",
        "submitted",
        "returned",
        "excused",
      ].map((x) => [x, x.replaceAll("_", " ")]),
    },
    { key: "due_date", label: "Date-only deadline", type: "date" },
    {
      key: "due_at",
      label: "Precise deadline (Vancouver)",
      type: "datetime-local",
    },
    {
      key: "dropped",
      label: "Exclude as a dropped assessment",
      type: "checkbox",
    },
    {
      key: "verification_status",
      label: "Verification",
      options: [
        ["unverified", "Source-reported / not verified"],
        ["user_confirmed", "Confirmed by me"],
        ["verified", "Checked against original source"],
      ],
    },
    {
      key: "notes",
      label: "Source notes / grading explanation",
      type: "textarea",
    },
  ],
  grading_categories: [
    { key: "course_id", label: "Course", table: "courses", required: true },
    { key: "name", label: "Category name", required: true },
    { key: "weight", label: "Category weight (%)", type: "number" },
    {
      key: "aggregation",
      label: "Within-category formula",
      options: [
        ["unknown", "Not confirmed"],
        ["points", "Total points"],
        ["equal_items", "Equal assessment percentages"],
        ["assessment_weights", "Explicit within-category weights"],
      ],
    },
    {
      key: "drop_lowest_count",
      label: "Drop lowest assessments",
      type: "number",
    },
  ],
  study_topics: [
    { key: "course_id", label: "Course", table: "courses", required: true },
    { key: "title", label: "Topic / concept", required: true },
    {
      key: "mastery",
      label: "Mastery",
      options: [
        ["unstudied", "Unstudied"],
        ["practicing", "Practicing"],
        ["needs_review", "Needs review"],
        ["mastered", "Mastered (confirmed through practice)"],
      ],
    },
    { key: "notes", label: "Practice evidence / next drill", type: "textarea" },
  ],
  study_sessions: [
    { key: "course_id", label: "Course", table: "courses", required: true },
    { key: "topic_id", label: "Topic", table: "study_topics" },
    {
      key: "start_at",
      label: "Started (Vancouver)",
      type: "datetime-local",
      required: true,
    },
    {
      key: "end_at",
      label: "Ended (Vancouver)",
      type: "datetime-local",
      required: true,
    },
    {
      key: "actual_minutes",
      label: "Actual study minutes (optional)",
      type: "number",
    },
    { key: "notes", label: "Session notes", type: "textarea" },
  ],
  contacts: [
    { key: "name", label: "Name", required: true },
    { key: "organization", label: "Organization" },
    { key: "role", label: "Role" },
    { key: "email", label: "Email" },
    {
      key: "last_contact_at",
      label: "Last contact (Vancouver)",
      type: "datetime-local",
    },
    { key: "next_follow_up_date", label: "Follow-up date", type: "date" },
    {
      key: "relationship_notes",
      label: "Relationship notes",
      type: "textarea",
    },
  ],
};
export function AcademicEditor({
  kind,
  record,
  seed,
  data,
  courseId,
  onClose,
  onSaved,
}: {
  kind: AcademicKind;
  record?: AcademicRow;
  seed?: Record<string, unknown>;
  data: AcademicData;
  courseId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [course, setCourse] = useState(String(record?.course_id ?? courseId ?? ""));
  const label = kind.replaceAll("_", " ");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const raw: Record<string, unknown> = {};
      const schema = academicSchemas[kind];
      const shape = schema.shape;
      if (record ?? seed)
        for (const key of Object.keys(shape))
          if (key in (record ?? seed!)) raw[key] = (record ?? seed!)[key];
      for (const field of definitions[kind]) {
        if (record?.completion_id && field.key !== "notes") continue;
        const value = String(form.get(field.key) ?? "");
        raw[field.key] =
          field.type === "checkbox"
            ? form.has(field.key)
            : field.type === "number"
              ? value === ""
                ? field.key === "drop_lowest_count"
                  ? 0
                  : null
                : Number(value)
              : field.type === "datetime-local"
                ? value
                  ? fromZonedTime(value, "America/Vancouver").toISOString()
                  : null
                : field.type === "date" || field.table
                  ? value || null
                  : field.key === "email"
                    ? value || null
                    : value;
      }
      if (kind === "courses" && !record)
        raw.verification_status = "user_confirmed";
      const values = schema.parse(raw);
      await calendarRequest(`/api/v1/${kind}${record ? "/" + record.id : ""}`, {
        method: record ? "PATCH" : "POST",
        body: JSON.stringify(
          record ? { version: record.version, data: values } : values,
        ),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof ZodError
          ? e.issues.map((i) => i.message).join(" ")
          : e instanceof Error
            ? e.message
            : "Save failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${record ? "Edit" : "Add"} ${label}`}
      description="Enter confirmed information. Unknown values stay blank; source-reported values can remain unverified."
    >
      <form onSubmit={save} className="academic-form">
        {definitions[kind].map((field) => {
          const initial =
            (record ?? seed)?.[field.key] ??
            (field.key === "course_id" ? courseId : undefined);
          const options = field.table
            ? data[field.table]
                .filter(
                  (row) =>
                    !row.course_id || !course || row.course_id === course,
                )
                .map(
                  (row) =>
                    [row.id, String(row.code ?? row.name ?? row.title)] as [
                      string,
                      string,
                    ],
                )
            : field.options;
          return (
            <label
              key={field.key}
              className={field.type === "checkbox" ? "inline-check" : undefined}
            >
              {field.type !== "checkbox" && field.label}
              {options ? (
                <select
                  name={field.key}
                  disabled={!!record?.completion_id && field.key !== "notes"}
                  required={field.required}
                  defaultValue={initial == null ? "" : String(initial)}
                  onChange={
                    field.key === "course_id"
                      ? (e) => setCourse(e.currentTarget.value)
                      : undefined
                  }
                >
                  {!field.options && (
                    <option value="">
                      {field.required ? "Choose…" : "None"}
                    </option>
                  )}
                  {options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  name={field.key}
                  disabled={!!record?.completion_id && field.key !== "notes"}
                  defaultValue={String(initial ?? "")}
                  maxLength={10000}
                />
              ) : (
                <input
                  name={field.key}
                  disabled={!!record?.completion_id && field.key !== "notes"}
                  type={field.type ?? "text"}
                  required={field.required}
                  step={field.type === "number" ? "any" : undefined}
                  defaultChecked={
                    field.type === "checkbox" ? !!initial : undefined
                  }
                  defaultValue={
                    field.type === "checkbox"
                      ? undefined
                      : field.type === "datetime-local" && initial
                        ? formatInTimeZone(
                            String(initial),
                            "America/Vancouver",
                            "yyyy-MM-dd'T'HH:mm",
                          )
                        : String(initial ?? "")
                  }
                />
              )}
              {field.type === "checkbox" && field.label}
            </label>
          );
        })}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save record"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
