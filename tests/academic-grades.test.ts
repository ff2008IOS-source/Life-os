import { expect, it } from "vitest";
it("points courses drop the lowest result in a drop-lowest category", async () => {
  const { academicGrade } = await import("@/lib/academic-grades");
  const row = (
    id: string,
    cat: string | null,
    e: number | null,
    m: number | null,
  ) => ({
    id,
    category_id: cat,
    weight: null,
    earned_score: e,
    maximum_score: m,
    dropped: false,
    submission_state: "returned",
    verification_status: "user_confirmed",
  });
  // PSYC 100 shape: exams plus ZAPS with the lowest dropped.
  const rows = [
    row("exam", null, 103, 125),
    row("z1", "zaps", 1.5, 2),
    row("z2", "zaps", 2, 2),
    row("z3", "zaps", 2, 2),
    row("how", "zaps", null, null),
  ];
  const cats = [
    {
      id: "zaps",
      weight: 0,
      drop_lowest_count: 1,
      aggregation: "unknown" as const,
    },
  ];
  const g = academicGrade("points", rows, cats, {
    inventoryComplete: false,
    rulesVerified: true,
  });
  expect(g.graded_average).toBeCloseTo(((103 + 4) / (125 + 4)) * 100, 5);
});
