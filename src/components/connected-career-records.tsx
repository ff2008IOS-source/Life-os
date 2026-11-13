"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { calendarRequest } from "./use-calendar";
import { RowEditor, type Dataset, type Row } from "./sheet-rest-panel";
type LinkRow = {
  project_id: string;
  dataset_id: string;
  row_id: string;
  field_key: string;
};
type SourceState = {
  datasets: Dataset[];
  rows?: Row[];
  links?: LinkRow[];
  next?: string | null;
};
/** The domain page uses the same ledger and guarded writes as integration settings. */
export function ConnectedCareerRecords() {
  const { data: workspace, refresh } = useWorkspace();
  const [state, setState] = useState<SourceState | null>(null),
    [dataset, setDataset] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const revision = ++generation.current;
    try {
      const value = await calendarRequest<SourceState>(
        "/api/v1/sheets/tables" + (dataset ? "?dataset=" + dataset : ""),
      );
      if (revision === generation.current) {
        setState(value);
        setError("");
      }
    } catch (e) {
      if (revision === generation.current)
        setError(
          e instanceof Error ? e.message : "Connected source unavailable.",
        );
    }
  }, [dataset]);
  useEffect(() => {
    void Promise.resolve().then(load);
    const tracker = generation;
    return () => {
      tracker.current++;
    };
  }, [load]);
  async function act(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await calendarRequest("/api/v1/sheets/tables", {
        method: "POST",
        body: JSON.stringify({ ...input, dataset_id: dataset }),
      });
      await Promise.all([load(), refresh()]);
      setNotice(
        input.action === "edit"
          ? "Local change saved. It remains pending until the authorized source write is confirmed."
          : input.action === "bind_project"
            ? "Project connected. Future mapped status edits use the guarded synchronization outbox."
            : "Source checked. Review any conflicts before assuming changes are synchronized.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Source operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const d = state?.datasets.find((x) => x.id === dataset);
  return (
    <section
      className="panel settings-panel"
      aria-label="Connected career and project records"
    >
      <h2>Connected career and project records</h2>
      <p className="small muted">
        These are the current mapped spreadsheet records. Only approved fields
        are editable. Formula values stay source-owned.
      </p>
      <label>
        Career source table
        <select
          value={dataset}
          disabled={busy}
          onChange={(e) => {
            setState((old) =>
              old ? { ...old, rows: undefined, next: null } : old,
            );
            setDataset(e.target.value);
            setNotice("");
          }}
        >
          <option value="">Choose a source table</option>
          {state?.datasets
            .filter((x) => !x.test_only)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} · {x.worksheet_title}
              </option>
            ))}
        </select>
      </label>
      {d && (
        <>
          <p className="small">
            {d.mode.replaceAll("_", " ")} · Last successful read:{" "}
            {d.last_read_at
              ? new Date(d.last_read_at).toLocaleString()
              : "Not yet confirmed"}
          </p>
          {d.last_error && <p role="alert">{d.last_error}</p>}
          <div className="inline">
            <Button
              size="sm"
              disabled={busy || d.mode === "paused"}
              onClick={() => void act({ action: "sync" })}
            >
              Sync source now
            </Button>
            <Link className="text-link" href="/settings?section=integrations">
              Approvals, conflicts and source settings
            </Link>
          </div>
          {state?.rows?.map((row) => {
            const link = state.links?.find((l) => l.row_id === row.id);
            return (
              <details key={row.id} className="briefing-detail">
                <summary>
                  {d.config.columns
                    .filter((c) => c.key_part)
                    .map((c) => String(row.local_values[c.key] ?? ""))
                    .join(" · ")}{" "}
                  · {row.state.replaceAll("_", " ")}
                </summary>
                {link && (
                  <p className="small">
                    Linked project:{" "}
                    {workspace.projects.find((p) => p.id === link.project_id)
                      ?.name ?? "Owned project"}
                    . Edit its normal project status to queue an authorized
                    source update.
                  </p>
                )}
                {d.mode === "two_way" || d.mode === "export_only" ? (
                  <RowEditor
                    key={row.id + ":" + row.version}
                    row={row}
                    config={d.config}
                    busy={busy}
                    save={(values) =>
                      void act({
                        action: "edit",
                        row_id: row.id,
                        version: row.version,
                        request_id: crypto.randomUUID(),
                        values,
                      })
                    }
                  />
                ) : (
                  <dl>
                    {d.config.columns.map((c) => (
                      <div key={c.key}>
                        <dt>{c.header}</dt>
                        <dd>{String(row.local_values[c.key] ?? "Unknown")}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!link && row.state === "synced" && (
                  <details>
                    <summary>
                      Connect this record to an existing project
                    </summary>
                    <p className="small muted">
                      Choose the project and exact source values. Current
                      statuses must agree. This does not create another project
                      or change the workbook.
                    </p>
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          project = workspace.projects.find(
                            (p) => p.id === f.get("project"),
                          );
                        if (!project) return;
                        void act({
                          action: "bind_project",
                          row_id: row.id,
                          version: row.version,
                          project_id: project.id,
                          project_version: project.version,
                          field: String(f.get("field")),
                          values_map: Object.fromEntries(
                            ["active", "paused", "completed", "cancelled"].map(
                              (k) => [k, String(f.get(k))],
                            ),
                          ),
                          confirmed: true,
                        });
                      }}
                    >
                      <label>
                        Project to connect
                        <select name="project" required>
                          <option value="">Choose an existing project</option>
                          {workspace.projects
                            .filter(
                              (p) =>
                                !p.is_example &&
                                !state.links?.some(
                                  (l) => l.project_id === p.id,
                                ),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.status}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Source status field
                        <select name="field" required>
                          <option value="">
                            Choose a literal status field
                          </option>
                          {d.config.columns
                            .filter(
                              (c) =>
                                c.writable && c.type === "text" && !c.key_part,
                            )
                            .map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.header}
                              </option>
                            ))}
                        </select>
                      </label>
                      {["active", "paused", "completed", "cancelled"].map(
                        (key) => (
                          <label key={key}>
                            Source value for {key}
                            <input name={key} required maxLength={100} />
                          </label>
                        ),
                      )}
                      <Button disabled={busy}>
                        Approve project connection
                      </Button>
                    </form>
                  </details>
                )}
              </details>
            );
          })}
          {state?.next && (
            <p className="small">
              <Link href="/settings?section=integrations">
                Open source settings for remaining records
              </Link>
              . This page shows the first 100; no aggregate totals are inferred.
            </p>
          )}
          {!state?.rows?.length && (
            <p className="small muted">No records on this source page.</p>
          )}
        </>
      )}
      {!state?.datasets.length && state && (
        <p className="small muted">
          No mapped source tables. Connect one in Settings; existing manual
          records stay intact.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
