import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() =>
  vi.fn(async () => ({
    data: { id: "11111111-1111-4111-8111-111111111111", status: "finished" },
    error: null,
  })),
);
vi.mock("@/lib/auth", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code = "REQUEST_FAILED",
    ) {
      super(message);
    }
  },
  authorized: async () => ({
    db: { rpc },
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));
import { POST } from "@/app/api/v1/focus/route";
afterEach(() => {
  vi.unstubAllEnvs();
  rpc.mockClear();
});
const request = (action: string) =>
  new Request("https://lifeos.example/api/v1/focus", {
    method: "POST",
    headers: {
      Origin: "https://lifeos.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      request_id: "22222222-2222-4222-8222-222222222222",
      actual_minutes: 5,
    }),
  });
it("blocks new timer starts when rollout is disabled", async () => {
  vi.stubEnv("LIFE_OS_DASHBOARD_V2", "false");
  vi.stubEnv("LIFE_OS_APP_ORIGIN", "https://lifeos.example");
  expect((await POST(request("start"))).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});
it("keeps existing session completion available during rollout rollback", async () => {
  vi.stubEnv("LIFE_OS_DASHBOARD_V2", "false");
  vi.stubEnv("LIFE_OS_APP_ORIGIN", "https://lifeos.example");
  expect((await POST(request("finish"))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "change_focus_session",
    expect.objectContaining({ p_action: "finish", p_minutes: 5 }),
  );
});
