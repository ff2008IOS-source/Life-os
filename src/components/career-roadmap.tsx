"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";
import { Button } from "./ui/button";
import { ConnectedCareerRecords } from "./connected-career-records";
import type { Dataset, Row } from "./sheet-rest-panel";
type Section = { dataset: Dataset; rows: Row[]; more: boolean; error?: string };
export function CareerRoadmap() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void calendarRequest<{
      datasets: Dataset[];
      overview: {
        dataset_id: string;
        rows: Row[];
        more: boolean;
        error?: string;
      }[];
    }>("/api/v1/sheets/tables?overview=true")
      .then((value) => {
        if (live) {
          setSections(
            value.datasets
              .filter((d) => !d.test_only && d.mode !== "paused")
              .map((dataset) => {
                const section = value.overview?.find(
                  (s) => s.dataset_id === dataset.id,
                );
                return {
                  dataset,
                  rows: section?.rows ?? [],
                  more: section?.more ?? false,
                  error: section?.error,
                };
              }),
          );
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e instanceof Error ? e.message : "Roadmap could not load.");
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <section id="connected-roadmap" className="panel career-roadmap">
      <div className="panel-heading">
        <h2>Roadmap</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          Refresh view
        </Button>
      </div>
      {!loaded && <p role="status">Loading your plans…</p>}
      {error && <p role="alert">{error}</p>}
      {loaded && !error && !sections.length && (
        <p className="small muted">
          Your active career plans will appear here. Start with a project or a
          goal that matters to you.
        </p>
      )}
      <div className="roadmap-sections">
        {sections.map((section) => (
          <section className="roadmap-section" key={section.dataset.id}>
            <h3>
              {section.dataset.title.split(" · ").at(-1) ||
                section.dataset.worksheet_title}
            </h3>
            {section.error && <p role="alert">{section.error}</p>}
            {section.dataset.last_error && (
              <p className="notice">
                This plan may be out of date.{" "}
                <Link href="/settings?section=integrations">
                  Check connection
                </Link>
              </p>
            )}
            {section.rows
              .filter(
                (row) => !["deleted", "remote_deleted"].includes(row.state),
              )
              .slice(0, 4)
              .map((row) => {
                const titleColumns = section.dataset.config.columns.filter(
                  (c) => c.key_part,
                );
                const title =
                  titleColumns
                    .map((c) => String(row.local_values[c.key] ?? ""))
                    .filter(Boolean)
                    .join(" · ") || "Untitled record";
                const details = section.dataset.config.columns.filter(
                  (c) =>
                    !c.key_part &&
                    row.local_values[c.key] !== null &&
                    row.local_values[c.key] !== "",
                );
                return (
                  <details className="roadmap-item" key={row.id}>
                    <summary>
                      {title}
                      {row.state !== "synced" && (
                        <span className="badge">
                          {row.state === "conflict"
                            ? "Needs review"
                            : "Changes pending"}
                        </span>
                      )}
                    </summary>
                    <dl>
                      {details.map((c) => (
                        <div key={c.key}>
                          <dt>{c.header}</dt>
                          <dd>{String(row.local_values[c.key] ?? "")}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                );
              })}
            {(section.rows.length > 4 || section.more) && (
              <details className="briefing-detail">
                <summary>More in {section.dataset.worksheet_title}</summary>
                {section.rows.slice(4).map((row) => (
                  <div className="roadmap-item" key={row.id}>
                    {section.dataset.config.columns
                      .filter((c) => c.key_part)
                      .map((c) => String(row.local_values[c.key] ?? ""))
                      .join(" · ")}
                  </div>
                ))}
                {section.more && (
                  <p className="small muted">
                    More records are available in source details.
                  </p>
                )}
              </details>
            )}
          </section>
        ))}
      </div>
      <details
        className="briefing-detail"
        onToggle={(e) => setSourcesOpen(e.currentTarget.open)}
      >
        <summary>Connected plan details</summary>
        {sourcesOpen && <ConnectedCareerRecords />}
      </details>
    </section>
  );
}
