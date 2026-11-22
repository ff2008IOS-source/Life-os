import { it, expect } from "vitest";
import {
  mergeConfirmed,
  affects,
  keepConfirmedRows,
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
