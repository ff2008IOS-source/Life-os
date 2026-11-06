import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  enabled: true,
  duplicate: false,
  writes: [] as { table: string; value: Record<string, unknown> }[],
  load: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../src/lib/services/workspace", () => ({
  loadWorkspaceForUser: state.load,
}));
vi.mock("../src/lib/services/scheduling", () => ({
  saveSchedulePreview: state.preview,
}));
vi.mock("../src/lib/integrations/calendar-write-server", () => ({
  applyReservations: state.apply,
}));
vi.mock("../src/lib/supabase/admin", () => ({
  serverAdmin: () => ({
    from: (table: string) => {
      let insert = false;
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        insert: () => {
          insert = true;
          return q;
        },
        update: (value: Record<string, unknown>) => {
          state.writes.push({ table, value });
          return q;
        },
        single: async () =>
          table === "integration_jobs" && state.duplicate
            ? { data: null, error: { code: "23505" } }
            : { data: { id: "job" }, error: null },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data:
              table === "scheduling_automation"
                ? state.enabled
                  ? [{ user_id: "owner", policy: {} }]
                  : []
                : table === "deletion_requests"
                  ? []
                  : insert
                    ? [{ id: "job" }]
                    : [],
            error: null,
          }),
      };
      return q;
    },
  }),
}));
import { runSchedulingAutomation } from "../src/lib/scheduling-automation";
beforeEach(() => {
  state.enabled = true;
  state.duplicate = false;
  state.writes = [];
  state.load.mockReset().mockResolvedValue({ tasks: [], projects: [] });
  state.preview
    .mockReset()
    .mockResolvedValue({ run_id: "run", blocks: [{}], warnings: [] });
  state.apply.mockReset().mockResolvedValue({ applied: 1 });
});
describe("opt-in background scheduling", () => {
  it("does no work while disabled", async () => {
    state.enabled = false;
    expect((await runSchedulingAutomation()).checked).toBe(0);
    expect(state.load).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("reports idle without inventing tasks or making reservations", async () => {
    await runSchedulingAutomation();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.writes.some((w) => w.value.last_status === "idle")).toBe(true);
  });
  it("excludes test data even when a test task has an estimate", async () => {
    state.load.mockResolvedValue({
      tasks: [
        {
          title: "[TEST] Example",
          estimated_minutes: 60,
          scheduling_mode: "eligible",
          status: "planned",
        },
      ],
      projects: [],
    });
    await runSchedulingAutomation();
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("uses the same validated reservation path for eligible estimated work and avoids duplicate interval jobs", async () => {
    state.load.mockResolvedValue({
      tasks: [
        {
          title: "Real action",
          estimated_minutes: 60,
          scheduling_mode: "eligible",
          status: "planned",
        },
      ],
      projects: [],
    });
    expect((await runSchedulingAutomation()).reserved).toBe(1);
    expect(state.apply).toHaveBeenCalledWith("run", "owner");
    state.apply.mockClear();
    state.duplicate = true;
    await runSchedulingAutomation();
    expect(state.apply).not.toHaveBeenCalled();
  });
});
