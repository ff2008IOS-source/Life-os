import { expect, it } from "vitest";
import { isClash, overlapKey } from "@/lib/overlaps";

const at = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 10, 26, h + 8, m)).toISOString(); // Vancouver = UTC-8

it("names a pair the same way in any order, ignoring the date", () => {
  const a = { title: "MBB · Practice", start: at(14) };
  const b = { title: "ECON 115 · Tutorial", start: at(14, 30) };
  expect(overlapKey(a, b)).toBe(overlapKey(b, a));
  expect(overlapKey(a, b)).toBe(
    overlapKey(
      {
        title: "MBB · Practice",
        start: new Date(Date.parse(at(14)) + 7 * 86400000).toISOString(),
      },
      {
        title: "ECON 115 · Tutorial",
        start: new Date(Date.parse(at(14, 30)) + 7 * 86400000).toISOString(),
      },
    ),
  );
  expect(overlapKey(a, b)).not.toBe(overlapKey(a, { ...b, start: at(15) }));
});

it("weekly pairs and accepted pairs are not clashes", () => {
  const a = { title: "Gym · A", start: at(9) };
  const b = { title: "Study · ECON 115", start: at(9, 30) };
  expect(isClash(a, b, new Set())).toBe(true);
  expect(
    isClash({ ...a, recurring: true }, { ...b, recurring: true }, new Set()),
  ).toBe(false);
  expect(isClash({ ...a, recurring: true }, b, new Set())).toBe(true);
  expect(isClash(a, b, new Set([overlapKey(a, b)]))).toBe(false);
});
