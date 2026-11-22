"use client";
import { useEffect, useState, useCallback } from "react";
import { FileSpreadsheet, RefreshCw, Plus, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./dialog";
import { calendarRequest, useCalendar } from "./use-calendar";
import { EntityEditor, type EntityEditorState } from "./entity-editor";
import { useWorkspace } from "./workspace-provider";
type CareerRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  details: Record<string, string | null>;
  source_key: string;
  source_id?: string | null;
};
type Preview = {
  preview_id: string;
  title: string;
  records?: CareerRow[];
  academic?: {
    terms: Record<string, unknown>[];
    courses: Record<string, unknown>[];
    assessments: Record<string, unknown>[];
    topics: Record<string, unknown>[];
  };
  warning: string;
};
const kinds = [
  ["contact", "Contacts"],
  ["career_goal", "Plans"],
  ["portfolio_project", "Portfolio"],
  ["skill", "Skills"],
  ["application_target", "Opportunities"],
  ["roadmap", "Roadmap"],
  ["review", "Source reviews"],
];
export function CareerPanel({ compact = false }: { compact?: boolean }) {
  const { data: connections } = useCalendar();
  const { data: workspace, refresh, notify } = useWorkspace();
  const [records, setRecords] = useState<CareerRow[]>([]),
    [tab, setTab] = useState("career_goal"),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [limit, setLimit] = useState(10),
    [editor, setEditor] = useState<EntityEditorState | null>(null);
  const load = useCallback(async () => {
    setRecords(
      (await calendarRequest<{ records: CareerRow[] }>("/api/v1/career/source"))
        .records,
    );
  }, []);
  useEffect(() => {
    let live = true;
    void calendarRequest<{ records: CareerRow[] }>("/api/v1/career/source")
      .then((d) => {
        if (live) setRecords(d.records);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const connection = connections?.connections.find(
    (c) => c.status === "connected",
  );
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Career request failed.");
    } finally {
      setBusy("");
    }
  }
  async function makePreview(academic = false) {
    await act("preview", async () => {
      if (!connection)
        throw Error(
          "Connect Google Calendar first so Life OS can identify the Google account.",
        );
      setPreview(
        await calendarRequest<Preview>("/api/v1/career/source", {
          method: "POST",
          body: JSON.stringify({
            action: academic ? "preview_academics" : "preview",
            connection_id: connection.id,
          }),
        }),
      );
    });
  }
  function promote(
    record: CareerRow,
    kind: "goals" | "projects" | "milestones",
  ) {
    const description = [
      "Imported source reference: https://docs.google.com/spreadsheets/d/1xDTpBdZ4FGXdTIcquq_pFXfTxdUy84xOD8vpgRAtgZc/edit",
      ...Object.entries(record.details)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`),
    ].join("\n");
    const rawDate = record.details.Deadline ?? record.details["Target Date"];
    const target =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    const seed = {
      title: record.title,
      name: record.title,
      description,
      source_id: record.source_id ?? null,
      source_key: record.source_key,
      area_id:
        workspace.areas.find(
          (a) =>
            a.slug ===
            (["Academics", "Beedie"].includes(record.details.Area ?? "")
              ? "academics"
              : "career"),
        )?.id ?? null,
      progress_type: "qualitative" as const,
      target_date: target,
    };
    setEditor({ kind, seed });
  }
  const alreadyLinked = (r: CareerRow, kind: "goals" | "projects") =>
    !!r.source_id &&
    workspace[kind].some(
      (row) => row.source_id === r.source_id && row.source_key === r.source_key,
    );
  const matching = records.filter((r) => r.kind === tab);
  return (
    <section
      className={compact ? "panel settings-panel" : "panel career-workspace"}
    >
      <div className="academic-toolbar">
        <div className="inline">
          <FileSpreadsheet size={18} />
          <h2>Career spreadsheet</h2>
        </div>
        <span className="badge">Read-only source</span>
      </div>
      <p className="muted small">
        Import actual source records with their original states and evidence.
        Existing imported rows are preserved; nothing is written back.
      </p>
      <div className="career-import-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy || !connection}
          onClick={() =>
            void act("connect", async () => {
              const { url } = await calendarRequest<{ url: string }>(
                "/api/v1/calendar/oauth/start",
                { method: "POST", body: JSON.stringify({ sheets: true }) },
              );
              window.location.assign(url);
            })
          }
        >
          Connect read-only spreadsheet
        </Button>
        <Button
          size="sm"
          disabled={!!busy || !connection}
          onClick={() => void makePreview()}
        >
          <RefreshCw size={13} />
          {busy === "preview" ? "Reading source…" : "Preview career import"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy || !connection}
          onClick={() => void makePreview(true)}
        >
          Preview academic import
        </Button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="connection-feedback">
          {message}
        </p>
      )}
      {!compact && (
        <>
          <div className="tabs">
            {kinds.map(([id, label]) => (
              <button
                key={id}
                className={`tab ${tab === id ? "active" : ""}`}
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  setLimit(10);
                }}
              >
                {label} · {records.filter((r) => r.kind === id).length}
              </button>
            ))}
          </div>
          <div className="career-record-list">
            {matching.slice(0, limit).map((record) => (
              <details key={record.id} className="career-record">
                <summary>
                  <span>
                    <strong>{record.title}</strong>
                    <small>
                      {record.details["Semester"] ??
                        record.details.Term ??
                        record.details["Source tab"]}
                    </small>
                  </span>
                  <span className="badge">
                    {record.status.replaceAll("_", " ")}
                  </span>
                </summary>
                <dl className="source-detail-list">
                  {Object.entries(record.details)
                    .filter(([, v]) => v)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
                <div className="career-import-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alreadyLinked(record, "goals")}
                    onClick={() => promote(record, "goals")}
                  >
                    <Plus size={12} />
                    {alreadyLinked(record, "goals")
                      ? "Already in Goals"
                      : "Create confirmed goal"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={alreadyLinked(record, "projects")}
                    onClick={() => promote(record, "projects")}
                  >
                    {alreadyLinked(record, "projects")
                      ? "Already in Projects"
                      : "Create project"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => promote(record, "milestones")}
                  >
                    Link as milestone
                  </Button>
                  <a
                    className="text-link"
                    href="https://docs.google.com/spreadsheets/d/1xDTpBdZ4FGXdTIcquq_pFXfTxdUy84xOD8vpgRAtgZc/edit"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source
                    <ExternalLink size={11} />
                  </a>
                </div>
              </details>
            ))}
            {!matching.length && (
              <p className="academic-note muted small">
                No source records imported in this section.
              </p>
            )}
            {matching.length > limit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimit((n) => n + 10)}
              >
                Show more ({matching.length - limit} remaining)
              </Button>
            )}
          </div>
        </>
      )}
      {preview && (
        <Modal
          open
          onOpenChange={(open) => !open && setPreview(null)}
          title="Review source import"
          description="Verify the mapped records before importing. Source-reported information remains explicitly unverified."
        >
          <div className="source-import-preview">
            <p className="academic-note muted small">{preview.warning}</p>
            {preview.academic ? (
              <div className="stack">
                {Object.entries(preview.academic)
                  .filter(([, rows]) => Array.isArray(rows))
                  .map(([label, rows]) => (
                    <details key={label}>
                      <summary>
                        {label} · {(rows as Record<string, unknown>[]).length}
                      </summary>
                      {(rows as Record<string, unknown>[]).map((row, i) => (
                        <div className="setting-line" key={i}>
                          <div>
                            <strong>
                              {String(
                                row.title ??
                                  row.code ??
                                  row.name ??
                                  "Source record",
                              )}
                            </strong>
                            <p>
                              {Object.entries(row)
                                .filter(
                                  ([k, v]) =>
                                    v !== null &&
                                    v !== "" &&
                                    ![
                                      "id",
                                      "source_key",
                                      "course_id",
                                      "term_id",
                                      "source_id",
                                    ].includes(k),
                                )
                                .map(
                                  ([k, v]) =>
                                    `${k.replaceAll("_", " ")}: ${String(v)}`,
                                )
                                .join(" · ")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </details>
                  ))}
              </div>
            ) : (
              <>
                {kinds.map(([kind, label]) => (
                  <details key={kind}>
                    <summary>
                      {label} ·{" "}
                      {preview.records?.filter((r) => r.kind === kind).length ??
                        0}
                    </summary>
                    {preview.records
                      ?.filter((r) => r.kind === kind)
                      .map((r) => (
                        <p className="muted small" key={r.source_key}>
                          {r.title} · {r.status}
                        </p>
                      ))}
                  </details>
                ))}
              </>
            )}
            <p className="academic-note muted small">
              No active tasks, calendar events, finance records or wellbeing
              records will be created. Confirmed goals and projects can be
              created from individual source records afterward.
            </p>
          </div>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!!busy}
              onClick={() =>
                void act("apply", async () => {
                  const result = await calendarRequest<{
                    imported_count: number;
                  }>("/api/v1/career/source", {
                    method: "POST",
                    body: JSON.stringify({
                      action: "apply",
                      preview_id: preview.preview_id,
                    }),
                  });
                  setMessage(
                    `${result.imported_count} new source records imported. Existing records preserved.`,
                  );
                  await load();
                  await refresh();
                  setPreview(null);
                })
              }
            >
              {busy === "apply" ? "Importing…" : "Import reviewed records"}
            </Button>
          </div>
        </Modal>
      )}
      {editor && (
        <EntityEditor
          state={editor}
          onClose={() => {
            setEditor(null);
            void refresh();
            notify("Review saved goals and projects in their workspace.");
          }}
        />
      )}
    </section>
  );
}
