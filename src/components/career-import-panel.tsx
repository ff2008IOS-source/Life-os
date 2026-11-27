"use client";
import { useState } from "react";
import { calendarRequest } from "./use-calendar";

type TabSummary = {
  tab: string;
  imported: number;
  matched: number;
  skipped: { row: string; reason: string }[];
  unresolved: { record: string; issue: string }[];
  notes: string[];
};
type Result = { dry_run: boolean; tabs: TabSummary[] };

/**
 * Settings → Connections: brings the Google Sheets career dashboard into
 * Life OS. Always previews first; importing again never duplicates records
 * or overwrites changes made in Life OS. The workbook itself is not edited.
 */
export function CareerImportPanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run = async (dry: boolean) => {
    setBusy(dry ? "preview" : "import");
    setError("");
    try {
      setResult(
        await calendarRequest<Result>("/api/v1/career/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dry_run: dry }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import didn't run.");
    } finally {
      setBusy("");
    }
  };
  return (
    <section
      className="panel settings-panel"
      aria-label="Career workbook import"
    >
      <h2>Career workbook</h2>
      <p>
        Brings your Google Sheets career dashboard into Life OS: people,
        applications, skills, portfolio, plans, weekly reviews and reference
        notes. Preview first; importing again is safe.
      </p>
      <div
        className="career-form-actions"
        style={{ justifyContent: "flex-start" }}
      >
        <button
          className="td-btn td-btn-ghost td-btn-sm"
          disabled={!!busy}
          onClick={() => void run(true)}
        >
          {busy === "preview" ? "Checking…" : "Preview import"}
        </button>
        {result?.dry_run && (
          <button
            className="td-btn td-btn-dark td-btn-sm"
            disabled={!!busy}
            onClick={() => void run(false)}
          >
            {busy === "import" ? "Importing…" : "Import"}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="import-summary">
          <p className="small muted">
            {result.dry_run
              ? "Preview: nothing has changed yet."
              : "Imported. Run it again any time; it won't duplicate."}
          </p>
          <table>
            <thead>
              <tr>
                <th>Tab</th>
                <th>New</th>
                <th>Matched</th>
                <th>Skipped</th>
                <th>To resolve</th>
              </tr>
            </thead>
            <tbody>
              {result.tabs.map((t) => (
                <tr key={t.tab}>
                  <td>{t.tab}</td>
                  <td>{t.imported}</td>
                  <td>{t.matched}</td>
                  <td>{t.skipped.length}</td>
                  <td>{t.unresolved.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.tabs.some(
            (t) => t.unresolved.length || t.notes.length || t.skipped.length,
          ) && (
            <details>
              <summary>Details</summary>
              {result.tabs.map((t) =>
                t.unresolved.length || t.notes.length || t.skipped.length ? (
                  <div key={t.tab} className="import-tab">
                    <h3>{t.tab}</h3>
                    <ul>
                      {t.unresolved.map((u, i) => (
                        <li key={"u" + i}>
                          <strong>{u.record}:</strong> {u.issue}
                        </li>
                      ))}
                      {t.skipped.map((u, i) => (
                        <li key={"s" + i} className="muted">
                          Skipped {u.row}: {u.reason}
                        </li>
                      ))}
                      {t.notes.map((n, i) => (
                        <li key={"n" + i} className="muted">
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
