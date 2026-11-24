"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, RefreshCw, FileText, Plus, Trash2 } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import type { AcademicData, AcademicRow } from "./academic-editor";
import { orderTerms } from "@/lib/course-visibility";
import {
  extractSyllabusWeights,
  matchWeightRow,
  type SyllabusWeight,
} from "@/lib/syllabus-weights";

type Material = { id: string; title: string; type: string; text?: string };
type Draft = {
  source: string | null;
  rows: SyllabusWeight[];
  /** Assessment id → row index, or -1 to leave out of the grade. */
  map: Record<string, number>;
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export { orderTerms };

async function json<T>(url: string, init?: RequestInit) {
  return calendarRequest<T>(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/**
 * Start-of-term checklist: bring the new courses in from Canvas, then read
 * each course's grading weights from its syllabus, check them and save.
 */
export function NewTermSetup() {
  const [data, setData] = useState<AcademicData | null>(null);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [syncing, setSyncing] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await calendarRequest<AcademicData>("/api/v1/academics"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Courses couldn’t load.");
    }
  }, []);
  useEffect(() => {
    let live = true;
    calendarRequest<AcademicData>("/api/v1/academics")
      .then((d) => live && setData(d))
      .catch(
        (e) =>
          live &&
          setError(e instanceof Error ? e.message : "Courses couldn’t load."),
      );
    return () => {
      live = false;
    };
  }, []);

  const terms = useMemo(
    () => (data ? orderTerms(data.academic_terms) : []),
    [data],
  );
  const activeTerm = term || str(terms[0]?.id);
  const courses = (data?.courses ?? []).filter(
    (c) => str(c.term_id) === activeTerm,
  );

  async function syncCanvas() {
    setSyncing("Bringing in your Canvas courses…");
    setMessage("");
    try {
      await json("/api/canvas/sync?refresh=true", { method: "POST" });
      await load();
      setSyncing("");
      setMessage(
        "Canvas is synced. New courses and terms appear below; large courses can take a few minutes to finish.",
      );
    } catch (e) {
      setSyncing("");
      setMessage(e instanceof Error ? e.message : "Canvas sync didn’t finish.");
    }
  }

  async function readSyllabus(course: AcademicRow) {
    if (!data) return;
    setOpen(course.id);
    setDraft(null);
    setBusy("read");
    try {
      const m = await calendarRequest<{ records: Material[] }>(
        `/api/canvas/materials?local_course=${course.id}&library=true&syllabus=true`,
      );
      const candidates = (m.records ?? [])
        .filter((r) => /syllab|course outline/i.test(r.title) && r.text)
        // Newest upload first (Canvas file ids increase over time).
        .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
      let rows: SyllabusWeight[] | null = null;
      let source: string | null = null;
      for (const c of candidates) {
        rows = extractSyllabusWeights(c.text ?? "");
        if (rows) {
          source = c.title;
          break;
        }
      }
      const assessments = data.assessments.filter(
        (a) => a.course_id === course.id && !a.dropped,
      );
      const cats = data.grading_categories;
      const map: Record<string, number> = {};
      for (const a of assessments) {
        const group = cats.find((g) => g.id === a.category_id);
        const byTitle = rows ? matchWeightRow(str(a.title), rows) : null;
        const byGroup =
          rows && group ? matchWeightRow(str(group.name), rows) : null;
        map[a.id] = byTitle ?? byGroup ?? -1;
      }
      setDraft({ source, rows: rows ?? [{ name: "", weight: 100 }], map });
    } catch (e) {
      setDraft({ source: null, rows: [{ name: "", weight: 100 }], map: {} });
      setMessage(
        e instanceof Error ? e.message : "The syllabus couldn’t be read.",
      );
    } finally {
      setBusy("");
    }
  }

  async function save(course: AcademicRow) {
    if (!data || !draft) return;
    const total = draft.rows.reduce((n, r) => n + (Number(r.weight) || 0), 0);
    if (
      Math.abs(total - 100) > 0.01 ||
      draft.rows.some((r) => !r.name.trim())
    ) {
      setMessage("Give every row a name and make the weights add up to 100%.");
      return;
    }
    setBusy("save");
    setMessage("");
    try {
      const existing = data.grading_categories.filter(
        (g) => g.course_id === course.id,
      );
      const ids: string[] = [];
      for (const row of draft.rows) {
        const same = existing.find(
          (g) =>
            str(g.name).trim().toLowerCase() === row.name.trim().toLowerCase(),
        );
        const values = {
          course_id: course.id,
          name: row.name.trim(),
          weight: Number(row.weight),
          drop_lowest_count: Number(same?.drop_lowest_count ?? 0),
          aggregation: "points",
        };
        if (same) {
          await json(`/api/v1/grading_categories/${same.id}`, {
            method: "PATCH",
            body: JSON.stringify({ version: same.version, data: values }),
          });
          ids.push(same.id);
        } else {
          const r = await json<{ data: { id: string } }>(
            "/api/v1/grading_categories",
            {
              method: "POST",
              headers: { "Idempotency-Key": crypto.randomUUID() },
              body: JSON.stringify(values),
            },
          );
          ids.push(r.data.id);
        }
      }
      // Canvas groups the syllabus doesn't list carry no weight.
      for (const g of existing)
        if (!ids.includes(g.id) && Number(g.weight ?? 0) !== 0)
          await json(`/api/v1/grading_categories/${g.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              version: g.version,
              data: {
                course_id: g.course_id,
                name: g.name,
                weight: 0,
                drop_lowest_count: g.drop_lowest_count ?? 0,
                aggregation: g.aggregation ?? "unknown",
              },
            }),
          });
      for (const a of data.assessments.filter(
        (x) => x.course_id === course.id && !x.dropped,
      )) {
        const index = draft.map[a.id] ?? -1;
        const category = index >= 0 ? ids[index] : a.category_id;
        const dropped = index < 0;
        if (category === a.category_id && !dropped) continue;
        await json(`/api/v1/assessments/${a.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            version: a.version,
            data: {
              course_id: a.course_id,
              category_id: category ?? null,
              task_id: a.task_id ?? null,
              title: a.title,
              weight: a.weight ?? null,
              maximum_score: a.maximum_score ?? null,
              earned_score: a.earned_score ?? null,
              submission_state: [
                "unknown",
                "not_submitted",
                "submitted",
                "returned",
                "excused",
              ].includes(str(a.submission_state))
                ? a.submission_state
                : "returned",
              due_at: a.due_at ?? null,
              due_date: a.due_date ?? null,
              verification_status: a.verification_status ?? "unverified",
              source_id: a.source_id ?? null,
              source_key: a.source_key ?? null,
              dropped,
              notes: dropped
                ? `${str(a.notes)}${a.notes ? "\n" : ""}Life OS: left out of the grade during term setup.`
                : (a.notes ?? ""),
              score_unit: a.score_unit ?? "points",
              source_status: a.source_status ?? null,
            },
          }),
        });
      }
      await json(`/api/v1/courses/${course.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: course.version,
          data: {
            term_id: course.term_id,
            code: course.code,
            title: course.title,
            description: course.description ?? "",
            grading_method: "category_weights",
            source_id: course.source_id ?? null,
            inventory_confirmed: !!course.inventory_confirmed,
            grading_rules_confirmed: true,
            verification_status: course.verification_status ?? "unverified",
          },
        }),
      });
      await load();
      setOpen(null);
      setDraft(null);
      setMessage(
        `${str(course.code)} weights saved. School now shows its weighted grade.`,
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Saving stopped partway; reopen the course to check it.",
      );
      await load();
    } finally {
      setBusy("");
    }
  }

  const total =
    draft?.rows.reduce((n, r) => n + (Number(r.weight) || 0), 0) ?? 0;

  return (
    <section
      className="panel settings-panel new-term"
      aria-label="New term setup"
    >
      <h2>New term setup</h2>
      <p className="small muted">
        Do this once at the start of each term. Canvas brings in the courses;
        each course’s grading weights come from its syllabus.
      </p>

      <ol className="new-term-steps">
        <li>
          <div>
            <strong>Bring in the new courses</strong>
            <span className="small muted">
              Syncs Canvas. New courses are added to their term automatically,
              with their assignments.
            </span>
          </div>
          <button
            type="button"
            className="td-btn td-btn-dark td-btn-sm"
            disabled={!!syncing}
            onClick={() => void syncCanvas()}
          >
            <RefreshCw size={14} aria-hidden />{" "}
            {syncing ? "Syncing…" : "Sync Canvas now"}
          </button>
        </li>
        <li>
          <div>
            <strong>Pick the term</strong>
            <span className="small muted">
              School opens on the newest term automatically.
            </span>
          </div>
          <select
            aria-label="Term to set up"
            value={activeTerm}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(null);
              setDraft(null);
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {str(t.name)}
              </option>
            ))}
          </select>
        </li>
        <li className="new-term-courses">
          <div>
            <strong>Read each course’s grading weights</strong>
            <span className="small muted">
              Finds the syllabus in Canvas, reads the grading breakdown and
              matches each assignment to it. Check it, then save.
            </span>
          </div>
        </li>
      </ol>

      {syncing && <p role="status">{syncing}</p>}
      {message && (
        <p role="status" className="td-muted">
          {message}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {data && !courses.length && (
        <p className="td-muted">
          No courses in this term yet. Sync Canvas once your new courses are
          published.
        </p>
      )}

      <ul className="new-term-list">
        {courses.map((c) => {
          const done =
            c.grading_rules_confirmed === true &&
            c.grading_method !== "unknown";
          const assessments = (data?.assessments ?? []).filter(
            (a) => a.course_id === c.id && !a.dropped,
          );
          return (
            <li key={c.id}>
              <div className="new-term-row">
                <span>
                  <strong>{str(c.code)}</strong>
                  <span className="td-muted">
                    {" "}
                    · {assessments.length} assessments
                  </span>
                </span>
                {done && open !== c.id ? (
                  <span className="td-pill td-pill-ok">
                    <Check size={13} aria-hidden /> Weights saved
                  </span>
                ) : null}
                <button
                  type="button"
                  className="td-btn td-btn-ghost td-btn-sm"
                  disabled={!!busy}
                  onClick={() => void readSyllabus(c)}
                >
                  <FileText size={14} aria-hidden />
                  {done ? "Re-read syllabus" : "Read weights from syllabus"}
                </button>
              </div>

              {open === c.id && (
                <div className="new-term-editor">
                  {busy === "read" && (
                    <p role="status">Reading the syllabus…</p>
                  )}
                  {draft && (
                    <>
                      <p className="small muted">
                        {draft.source
                          ? `From “${draft.source}”. Check the names and weights.`
                          : "No grading breakdown found in a syllabus for this course. Enter the weights from the course outline."}
                      </p>
                      <table className="new-term-table">
                        <thead>
                          <tr>
                            <th scope="col">Component</th>
                            <th scope="col">Weight</th>
                            <th scope="col">
                              <span className="sr-only">Remove</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {draft.rows.map((r, i) => (
                            <tr key={i}>
                              <td>
                                <input
                                  aria-label={`Component ${i + 1} name`}
                                  value={r.name}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      rows: draft.rows.map((x, j) =>
                                        j === i
                                          ? { ...x, name: e.target.value }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Component ${i + 1} weight`}
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  value={r.weight}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      rows: draft.rows.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              weight: Number(e.target.value),
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                                %
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="td-link"
                                  aria-label={`Remove ${r.name || "component"}`}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      rows: draft.rows.filter(
                                        (_, j) => j !== i,
                                      ),
                                      map: Object.fromEntries(
                                        Object.entries(draft.map).map(
                                          ([k, v]) => [
                                            k,
                                            v === i ? -1 : v > i ? v - 1 : v,
                                          ],
                                        ),
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 size={14} aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>
                              <button
                                type="button"
                                className="td-link"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    rows: [
                                      ...draft.rows,
                                      { name: "", weight: 0 },
                                    ],
                                  })
                                }
                              >
                                <Plus size={14} aria-hidden /> Add component
                              </button>
                            </td>
                            <td
                              className={
                                Math.abs(total - 100) < 0.01
                                  ? "td-ok"
                                  : "td-hot"
                              }
                            >
                              Total {Math.round(total * 10) / 10}%
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>

                      <h3 className="new-term-sub">
                        Which component is each assessment?
                      </h3>
                      <ul className="new-term-map">
                        {assessments.map((a) => (
                          <li key={a.id}>
                            <label htmlFor={`map-${a.id}`}>
                              {str(a.title)}
                            </label>
                            <select
                              id={`map-${a.id}`}
                              value={draft.map[a.id] ?? -1}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  map: {
                                    ...draft.map,
                                    [a.id]: Number(e.target.value),
                                  },
                                })
                              }
                            >
                              {draft.rows.map((r, i) => (
                                <option key={i} value={i}>
                                  {r.name || `Component ${i + 1}`}
                                </option>
                              ))}
                              <option value={-1}>Leave out of the grade</option>
                            </select>
                          </li>
                        ))}
                      </ul>

                      <div className="td-actions">
                        <button
                          type="button"
                          className="td-btn td-btn-primary td-btn-sm"
                          disabled={!!busy}
                          onClick={() => void save(c)}
                        >
                          {busy === "save" ? "Saving…" : "Save weights"}
                        </button>
                        <button
                          type="button"
                          className="td-btn td-btn-ghost td-btn-sm"
                          onClick={() => {
                            setOpen(null);
                            setDraft(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="small muted">
        Tip: after saving, open <Link href="/areas/academics">School</Link> to
        see each course’s weighted grade.
      </p>
    </section>
  );
}
