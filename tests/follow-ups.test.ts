import { describe, expect, it } from "vitest";
import {
  applicationDeadlines,
  followUps,
  sheetDate,
  todaySerial,
} from "@/lib/follow-ups";

const now = new Date("2026-11-24T20:00:00Z"); // Nov 24, Vancouver
const row = (id: string, v: Record<string, unknown>) => ({
  id,
  version: 1,
  dataset_id: "d",
  state: "synced",
  local_values: v,
});

describe("career follow-ups", () => {
  it("reads sheet serial dates", () => {
    expect(sheetDate(46323)).toBe("2026-10-28");
    expect(sheetDate("2026-11-01")).toBe("2026-11-01");
    expect(sheetDate("Follow up when available")).toBeNull();
    expect(todaySerial(now)).toBe(46350);
  });
  it("puts never-contacted and overdue people first", () => {
    const list = followUps(
      [
        row("recent", { name: "Recent", last_contact: 46345 }),
        row("old", { name: "Old", last_contact: 46300 }),
        row("never", { name: "Never", last_contact: null }),
      ],
      now,
    );
    expect(list.map((f) => f.name)).toEqual(["Never", "Old", "Recent"]);
    expect(list.map((f) => f.due)).toEqual([true, true, false]);
    expect(list[1].days_since).toBe(50);
  });
  it("lists only upcoming, undecided application deadlines", () => {
    const d = applicationDeadlines(
      [
        row("a", {
          organization_role: "BMO",
          status: "Research",
          deadline: "2026-12-01",
        }),
        row("b", {
          organization_role: "RBC",
          status: "Applied",
          deadline: "2026-11-30",
        }),
        row("c", {
          organization_role: "Old",
          status: "Research",
          deadline: "2026-11-01",
        }),
        row("d", { organization_role: "No date", status: "Research" }),
      ],
      now,
    );
    expect(d.map((x) => x.title)).toEqual(["BMO"]);
  });
});
it("uses a conversation logged in Life OS when it's newer than the sheet", () => {
  const [f] = followUps(
    [row("k", { name: "Kaden", last_contact: 46300 })],
    now,
    30,
    [
      {
        id: "c1",
        version: 2,
        source_key: "sheet-row:k",
        last_contact_at: "2026-11-24T18:00:00Z",
      },
    ],
  );
  expect(f.last_contact).toBe("2026-11-24");
  expect(f.due).toBe(false);
  expect(f.record).toEqual({ id: "c1", version: 2 });
});
