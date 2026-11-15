import { expect, it, vi } from "vitest";
import {
  syncAllTables,
  type BatchResult,
} from "@/lib/integrations/sheet-sync-batch";
it("syncs every active personal table once, skips paused/tests, continues after failure and reports conflicts", async () => {
  const tables = ["a", "b", "c", "d"].map((id) => ({
    id,
    title: id,
    mode: "two_way",
  }));
  const sync = vi.fn(async (id: string) => {
    if (id === "b") throw Error("Google authorization needs renewal");
    return { conflicts: id === "c" ? 1 : 0, confirmed: 0 };
  });
  const snapshots: BatchResult[][] = [];
  const results = await syncAllTables(
    [
      ...tables,
      { id: "paused", title: "Paused", mode: "paused" },
      { id: "test", title: "Test", mode: "two_way", test_only: true },
    ],
    sync,
    (r) => snapshots.push(r),
  );
  expect(sync.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d"]);
  expect(results.map((r) => r.status)).toEqual([
    "synced",
    "failed",
    "attention",
    "synced",
  ]);
  expect(results[1].message).toContain("authorization");
  expect(snapshots[0].every((r) => r.status === "waiting")).toBe(true);
});
it("stops before starting another table when cancelled; never retries a timed-out write", async () => {
  let cancelled = false;
  const sync = vi.fn(async () => {
    cancelled = true;
    throw new DOMException("Timed out", "TimeoutError");
  });
  const results = await syncAllTables(
    ["a", "b"].map((id) => ({ id, title: id, mode: "two_way" })),
    sync,
    () => {},
    () => cancelled,
  );
  expect(sync).toHaveBeenCalledTimes(1);
  expect(results[0].message).toContain("before retrying");
  expect(results.map((r) => r.status)).toEqual(["failed", "waiting"]);
});
