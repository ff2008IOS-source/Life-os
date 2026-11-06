"use client";
import { useEffect, useState, useCallback } from "react";
import { Button } from "./ui/button";
import {
  AcademicEditor,
  type AcademicData,
  type AcademicRow,
} from "./academic-editor";
import { calendarRequest } from "./use-calendar";
const empty: AcademicData = {
  academic_terms: [],
  courses: [],
  assessments: [],
  grading_categories: [],
  study_topics: [],
  study_sessions: [],
};
export function ContactsPanel() {
  const [rows, setRows] = useState<AcademicRow[]>([]),
    [page, setPage] = useState(0),
    [editor, setEditor] = useState<{ record?: AcademicRow } | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(
    async () =>
      setRows(
        (
          await calendarRequest<{ data: AcademicRow[] }>(
            `/api/v1/contacts?page=${page}`,
          )
        ).data,
      ),
    [page],
  );
  useEffect(() => {
    let live = true;
    void calendarRequest<{ data: AcademicRow[] }>(
      `/api/v1/contacts?page=${page}`,
    )
      .then((d) => {
        if (live) setRows(d.data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [page]);
  return (
    <section className="panel settings-panel">
      <div className="academic-toolbar">
        <h2>Contact follow-ups</h2>
        <Button size="sm" onClick={() => setEditor({})}>
          Add contact
        </Button>
      </div>
      <p className="muted small">
        Record actual conversations and follow-up dates. Nothing is sent to your
        contacts.
      </p>
      {rows.map((r) => (
        <div className="setting-line" key={r.id}>
          <div>
            <strong>{String(r.name)}</strong>
            <p>
              {[
                r.organization,
                r.role,
                r.next_follow_up_date
                  ? `Follow up ${r.next_follow_up_date}`
                  : null,
              ]
                .filter(Boolean)
                .map(String)
                .join(" · ")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditor({ record: r })}
          >
            Edit
          </Button>
        </div>
      ))}
      {!rows.length && (
        <p className="muted small">No confirmed contacts on this page.</p>
      )}
      <div className="career-import-actions">
        {page > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
        )}
        {rows.length === 50 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
          >
            Next 50
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {editor && (
        <AcademicEditor
          kind="contacts"
          record={editor.record}
          data={empty}
          onSaved={reload}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
