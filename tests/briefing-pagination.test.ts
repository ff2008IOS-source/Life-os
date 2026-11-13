import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { loadBriefingRows } from "@/lib/briefing-server";
function fixture(total: number) {
  const calls: URL[] = [];
  const db = createClient("https://fixture.invalid", "test-key", {
    global: {
      fetch: async (input) => {
        const u = new URL(String(input));
        calls.push(u);
        expect(u.searchParams.get("user_id")).toBe("eq.owner");
        expect(u.searchParams.get("order")).toBe("id.asc");
        const offset = Number(u.searchParams.get("offset") ?? 0),
          limit = Number(u.searchParams.get("limit"));
        expect(limit).toBe(500);
        return new Response(
          JSON.stringify(
            Array.from(
              { length: Math.max(0, Math.min(limit, total - offset)) },
              (_, n) => ({ id: String(offset + n) }),
            ),
          ),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  return { db, calls };
}
it("pages owned records without assuming a provider returns more than 500 rows", async () => {
  const { db, calls } = fixture(1001);
  const rows = await loadBriefingRows<{ id: string }>(
    db,
    "owner",
    "assessments",
    "id",
  );
  expect(rows).toHaveLength(1001);
  expect(calls).toHaveLength(3);
  expect(rows[1000].id).toBe("1000");
});
it("reports overflow instead of a misleading truncated total", async () => {
  const { db, calls } = fixture(2001);
  await expect(
    loadBriefingRows(db, "owner", "assessments", "id"),
  ).rejects.toThrow("collection limit");
  expect(calls).toHaveLength(5);
});
