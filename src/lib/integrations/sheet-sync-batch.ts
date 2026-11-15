export type BatchTable = {
  id: string;
  title: string;
  mode: string;
  test_only?: boolean;
};
export type BatchResult = {
  id: string;
  title: string;
  status: "waiting" | "syncing" | "synced" | "attention" | "failed";
  message?: string;
};
export type SyncResult = {
  conflicts?: number;
  held_outbound?: boolean;
  confirmed?: number;
};
/** One request per active personal table. Approval, leases and provider verification stay on the server. */
export async function syncAllTables(
  tables: BatchTable[],
  sync: (id: string) => Promise<SyncResult>,
  progress: (results: BatchResult[]) => void,
  cancelled: () => boolean = () => false,
) {
  const results: BatchResult[] = tables
    .filter((t) => !t.test_only && t.mode !== "paused")
    .map((t) => ({ id: t.id, title: t.title, status: "waiting" }));
  const publish = () => progress(results.map((r) => ({ ...r })));
  publish();
  for (const result of results) {
    if (cancelled()) break;
    result.status = "syncing";
    publish();
    try {
      const value = await sync(result.id);
      result.status =
        value.conflicts || value.held_outbound ? "attention" : "synced";
      if (result.status === "attention")
        result.message = "Updated; some changes need review.";
    } catch (e) {
      result.status = "failed";
      result.message =
        e instanceof Error
          ? e.message
          : "Could not sync. Check this table and try again.";
    }
    publish();
  }
  return results;
}
