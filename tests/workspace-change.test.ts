import { it, expect } from "vitest";
import {
  mergeConfirmed,
  affects,
  keepConfirmedRows,
  clearVerifiedRead,
} from "@/lib/workspace-change";
it("never lets an older confirmation overwrite a newer row", () => {
  const rows = [{ id: "t", version: 4, title: "latest" }];
  expect(mergeConfirmed(rows, { id: "t", version: 2, title: "old" })).toBe(
    rows,
  );
  expect(
    mergeConfirmed(rows, { id: "new", version: 1, title: "created" }),
  ).toHaveLength(2);
});
it("does not invalidate spreadsheet views on a task-only change", () => {
  const event = new Event("lifeos:changed");
  Object.assign(event, { detail: { entities: ["tasks"] } });
  expect(affects(event, ["sheets"])).toBe(false);
  expect(affects(event, ["tasks"])).toBe(true);
});

it("keeps a confirmed row when a later read returns an older replica snapshot", () => {
  const current = { tasks: [{ id: "t", version: 3, title: "confirmed" }] };
  const incoming = { tasks: [{ id: "t", version: 1, title: "old" }] };
  expect(
    keepConfirmedRows(incoming, current, new Map([["tasks:t", 3]])),
  ).toEqual(current);
  expect(
    keepConfirmedRows({ tasks: [] }, current, new Map([["tasks:t", 3]])),
  ).toEqual(current);
});

it("an older or stale verification cannot acknowledge a newer pending save", () => {
  const old = { version: 1 },
    latest = { version: 2 },
    pending = new Map([["tasks:t", latest]]);
  clearVerifiedRead(pending, "tasks:t", old, { version: 2 });
  expect(pending.get("tasks:t")).toBe(latest);
  clearVerifiedRead(pending, "tasks:t", latest, { version: 1 });
  expect(pending.size).toBe(1);
  clearVerifiedRead(pending, "tasks:t", latest, { version: 2 });
  expect(pending.size).toBe(0);
});
