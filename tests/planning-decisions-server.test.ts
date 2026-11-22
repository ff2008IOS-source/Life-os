import { it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  move: null as Record<string, unknown> | null,
  moves: 0,
  failFinal: false,
  blockWrites: 0,
}));
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  blockId = "33333333-3333-4333-8333-333333333333",
  taskId = "44444444-4444-4444-8444-444444444444";
const task = {
  id: taskId,
  title: "Original title",
  status: "planned",
  area_id: "a",
  scheduling_mode: "eligible",
  estimated_minutes: 90,
  actual_minutes: 0,
  priority: 3,
  due_date: "2026-11-12",
  due_at: null,
  deleted_at: null,
};
const block = {
  id: blockId,
  task_id: taskId,
  version: 1,
  flexibility: "flexible",
  status: "planned",
  start_at: "2026-11-09T22:00:00Z",
  end_at: "2026-11-09T22:45:00Z",
};
function query(table: string) {
  let update: Record<string, unknown> | undefined;
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return q;
    },
    in: () => q,
    not: () => q,
    neq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => run(true),
    single: () => run(true),
    update: (value: Record<string, unknown>) => {
      update = value;
      return q;
    },
    then: (resolve: (r: unknown) => unknown) => run(false).then(resolve),
  };
  async function run(single: boolean) {
    let rows: Record<string, unknown>[] = [];
    if (table === "integration_jobs") {
      if (filters.job_type === "calendar_reschedule")
        rows = state.move ? [state.move] : [];
      else if (update) {
        if (state.failFinal && update.status === "completed") {
          state.failFinal = false;
          return {
            data: null,
            error: { message: "Synthetic ledger response lost" },
          };
        }
        if (
          state.job &&
          (filters.version === undefined ||
            filters.version === state.job.version)
        ) {
          Object.assign(state.job, update, {
            version: Number(state.job.version) + 1,
          });
          rows = [state.job];
        }
      } else rows = state.job ? [state.job] : [];
    } else if (table === "work_blocks") {
      if (update) {
        expect(filters.id).toBe(blockId);
        expect(filters.user_id).toBe(owner);
        state.blockWrites++;
      }
      rows = [
        {
          ...block,
          status: state.blockWrites ? "cancelled" : "planned",
          version: state.moves ? 2 : 1,
        },
      ];
    } else if (table === "calendars")
      rows = [
        {
          id: "c",
          connection_id: "account",
          coverage_start: "2026-11-01T00:00:00Z",
          coverage_end: "2026-12-01T00:00:00Z",
          last_synced_at: new Date().toISOString(),
          sync_enabled: true,
          sync_error: null,
        },
      ];
    else if (table === "calendar_connections")
      rows = [{ id: "account", status: "connected" }];
    else if (table === "scheduling_automation") rows = [{ policy: {} }];
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  }
  return q;
}
vi.mock("../src/lib/supabase/admin", () => ({
  serverAdmin: () => ({ from: query }),
}));
vi.mock("../src/lib/services/workspace", () => ({
  loadPlanningWorkspaceForUser: async () => ({
    tasks: [task],
    areas: [{ id: "a", slug: "academics" }],
    dependencies: [],
  }),
}));
vi.mock("../src/lib/integrations/calendar-move-server", () => ({
  moveManagedSession: async () => {
    if (!state.move) {
      state.moves++;
      state.move = { status: "completed" };
    }
    return { confirmed: true };
  },
}));
vi.mock("../src/lib/integrations/calendar-write-server", () => ({
  undoReservations: vi.fn(),
}));
import { undoReservations } from "@/lib/integrations/calendar-write-server";
import { applyPlanningDecision } from "@/lib/services/planning-decisions";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T18:00:00Z"));
  state.moves = 0;
  state.blockWrites = 0;
  vi.mocked(undoReservations).mockClear();
  state.move = null;
  state.failFinal = false;
  state.job = {
    id,
    user_id: owner,
    version: 1,
    status: "pending",
    job_type: "work_replan_proposal",
    payload: {
      block_id: blockId,
      task_id: taskId,
      version: 1,
      title: "Original title",
      original_start: block.start_at,
      original_end: block.end_at,
      deadline: task.due_date,
      reason: "Class changed",
      replacement: {
        start_at: "2026-11-09T20:00:00Z",
        end_at: "2026-11-09T20:45:00Z",
      },
    },
  };
});
afterEach(() => vi.useRealTimers());
it("accepts a proposal once and safely replays the same decision", async () => {
  await applyPlanningDecision(owner, id, "accept");
  await applyPlanningDecision(owner, id, "accept");
  expect(state.moves).toBe(1);
  expect(state.job?.status).toBe("completed");
  expect(task.due_date).toBe("2026-11-12");
});
it("reconciles a confirmed provider move if the final ledger update response fails", async () => {
  state.failFinal = true;
  await expect(applyPlanningDecision(owner, id, "accept")).rejects.toThrow();
  await applyPlanningDecision(owner, id, "accept");
  expect(state.moves).toBe(1);
  expect(state.job?.status).toBe("completed");
});
it("rejects a stale block without moving a provider event", async () => {
  state.moves = 1;
  await expect(applyPlanningDecision(owner, id, "accept")).rejects.toThrow(
    /changed/,
  );
  expect(state.move).toBeNull();
});

it("dropping a local block never invokes an unscoped calendar-run undo", async () => {
  await applyPlanningDecision(owner, id, "drop");
  await applyPlanningDecision(owner, id, "drop");
  expect(state.blockWrites).toBe(1);
  expect(undoReservations).not.toHaveBeenCalled();
  expect(state.job?.status).toBe("completed");
});
