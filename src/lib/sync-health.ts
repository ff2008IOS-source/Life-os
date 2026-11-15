export type SyncSource = {
  id: string;
  name: string;
  lastSuccess: string | null;
  issue: string | null;
};
/** Oldest per-source success is a coverage watermark, never a fictitious combined job. */
export function aggregateSyncHealth(sources: SyncSource[]) {
  const dates = sources
    .map((s) => s.lastSuccess)
    .filter((d): d is string => !!d && Number.isFinite(Date.parse(d)));
  return {
    status: sources.some((s) => s.issue)
      ? "needs_attention"
      : sources.length
        ? "connected"
        : "not_connected",
    last_coverage_at:
      dates.length === sources.length && sources.length
        ? dates.toSorted((a, b) => Date.parse(a) - Date.parse(b))[0]
        : null,
    sources,
    affected: sources.filter((s) => s.issue).length,
  };
}
