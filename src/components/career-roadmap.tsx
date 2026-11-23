"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { calendarRequest } from "./use-calendar";
import { ConnectedCareerRecords } from "./connected-career-records";
import { ReconnectGoogle, needsReconnect } from "./reconnect-google";
import type { Dataset, Row } from "./sheet-rest-panel";
import { cellText } from "@/lib/sheet-cell";
import { dayLabel } from "@/lib/display";
import {
  CAREER_GROUPS,
  careerGroup,
  orderCareerRows,
  type CareerGroup,
} from "@/lib/career-order";

type Section = { dataset: Dataset; rows: Row[]; more: boolean; error?: string };
const SHOWN = 6;

function rowTitle(section: Section, row: Row) {
  return (
    section.dataset.config.columns
      .filter((c) => c.key_part)
      .map((c) => cellText(c.header, row.local_values[c.key]))
      .filter(Boolean)
      .join(" · ") || "Untitled record"
  );
}

export function CareerRoadmap() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [tab, setTab] = useState<CareerGroup>("plan");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
        if (!live) return;
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
        setError("");
        setLoaded(true);
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

  const name = (s: Section) =>
    s.dataset.title.split(" · ").at(-1) || s.dataset.worksheet_title;
  const groups = CAREER_GROUPS.filter((g) =>
    sections.some((s) => careerGroup(name(s)) === g.id),
  );
  const activeTab = groups.some((g) => g.id === tab)
    ? tab
    : (groups[0]?.id ?? "plan");
  const visible = sections.filter((s) => careerGroup(name(s)) === activeTab);
  const stale = sections.filter((s) => s.dataset.last_error);
  const lastRead = sections
    .map((s) => s.dataset.last_read_at)
    .filter((x): x is string => !!x)
    .sort()[0];
  const signIn = needsReconnect(stale.map((s) => s.dataset.last_error));

  return (
    <section id="connected-roadmap" className="td-card career-roadmap">
      <div className="td-card-head">
        <h2 className="td-card-title">Roadmap</h2>
        <button
          type="button"
          className="td-link"
          onClick={() => {
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={14} aria-hidden /> Refresh view
        </button>
      </div>
      {stale.length > 0 && (
        <div className="td-reconnect" role="status">
          <p>
            {signIn
              ? "Your career sheets stopped updating because Google needs you to sign in again."
              : `${stale.length} of your career sheets didn’t update.`}
            {lastRead ? ` Showing what was saved ${dayLabel(lastRead)}.` : ""}
          </p>
          {signIn ? (
            <ReconnectGoogle />
          ) : (
            <Link
              className="td-btn td-btn-ghost td-btn-sm"
              href="/settings?section=integrations"
            >
              Check connection
            </Link>
          )}
        </div>
      )}
      {!loaded && <p role="status">Loading your plans…</p>}
      {error && <p role="alert">{error}</p>}
      {loaded && !error && !sections.length && (
        <p className="td-muted">
          Your career plans will appear here once a spreadsheet is connected in
          Settings.
        </p>
      )}
      {groups.length > 1 && (
        <div className="career-tabs" role="tablist" aria-label="Career plan">
          {groups.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.id === activeTab}
              className={`career-tab ${g.id === activeTab ? "active" : ""}`}
              onClick={() => setTab(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div className="career-grid" role="tabpanel">
        {visible.map((section) => {
          const rows = orderCareerRows(
            section.rows.filter(
              (row) => !["deleted", "remote_deleted"].includes(row.state),
            ),
            (row) => rowTitle(section, row),
          );
          const open = expanded[section.dataset.id];
          const shown = open ? rows : rows.slice(0, SHOWN);
          return (
            <section className="career-block" key={section.dataset.id}>
              <h3>
                {name(section)}
                <span className="td-muted"> · {rows.length}</span>
              </h3>
              {section.error && <p role="alert">{section.error}</p>}
              {!rows.length && <p className="td-muted">Nothing here yet.</p>}
              <ul>
                {shown.map((row) => {
                  const details = section.dataset.config.columns.filter(
                    (c) =>
                      !c.key_part &&
                      row.local_values[c.key] !== null &&
                      row.local_values[c.key] !== "",
                  );
                  return (
                    <li key={row.id}>
                      <details className="career-row">
                        <summary>
                          <span>{rowTitle(section, row)}</span>
                          {row.state !== "synced" && (
                            <span className="badge">
                              {row.state === "conflict"
                                ? "Needs review"
                                : "Changes pending"}
                            </span>
                          )}
                        </summary>
                        {details.length > 0 && (
                          <dl>
                            {details.map((c) => (
                              <div key={c.key}>
                                <dt>{c.header}</dt>
                                <dd>
                                  {cellText(c.header, row.local_values[c.key])}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
              {(rows.length > SHOWN || section.more) && (
                <button
                  type="button"
                  className="td-link"
                  onClick={() =>
                    setExpanded((e) => ({
                      ...e,
                      [section.dataset.id]: !open,
                    }))
                  }
                >
                  {open
                    ? "Show fewer"
                    : `Show all ${rows.length}${section.more ? "+" : ""}`}
                </button>
              )}
            </section>
          );
        })}
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
