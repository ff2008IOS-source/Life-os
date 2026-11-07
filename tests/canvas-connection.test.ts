import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  allowed: true,
  writeError: false,
  sameAccount: true,
  identity: vi.fn(),
  seed: vi.fn(),
  tables: [] as string[],
}));
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
  authorized: vi.fn(async () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  serverAdmin: () => ({
    rpc: async (name: string) => ({
      data: name === "canvas_bind_identity" ? state.sameAccount : state.allowed,
      error: null,
    }),
    from: (name: string) => {
      state.tables.push(name);
      return {
        upsert: async (row: Record<string, unknown>) => {
          if (state.writeError) return { error: { code: "XX000" } };
          state.row = { ...state.row, ...row };
          return { error: null };
        },
      };
    },
  }),
}));
vi.mock("@/lib/canvas/service", () => ({
  seedCanvas: (id: string) => state.seed(id),
  canvasStatus: async () => ({
    connected: !!state.row,
    expires_at: state.row?.expires_at,
  }),
}));
import { POST, GET } from "../src/app/api/canvas/connection/route";
import { CanvasClient, CanvasApiError } from "../src/lib/canvas/client";
import { decryptToken } from "../src/lib/canvas/secure";
const owner = "11111111-1111-4111-8111-111111111111";
function request(
  token = "synthetic-first-token",
  origin = "https://lifeos-test.vercel.app",
) {
  return new Request(origin + "/api/canvas/connection", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      expires_at: new Date(Date.now() + 25 * 86400000).toISOString(),
    }),
  });
}
beforeEach(() => {
  state.row = null;
  state.allowed = true;
  state.writeError = false;
  state.sameAccount = true;
  state.tables = [];
  state.seed.mockReset();
  vi.stubEnv("CANVAS_ENCRYPTION_KEY", "11".repeat(32));
  vi.stubEnv("LIFE_OS_APP_ORIGIN", "https://lifeos-test.vercel.app");
  vi.stubEnv("VERCEL_ENV", "");
  vi.spyOn(CanvasClient.prototype, "identity").mockResolvedValue({ id: 123 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("Canvas connection route", () => {
  it("validates before storing encrypted credentials and never returns the token", async () => {
    const r = await POST(request());
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("synthetic-first-token");
    expect(state.row?.token_ciphertext).not.toContain("synthetic-first-token");
    expect(
      decryptToken(
        String(state.row?.token_ciphertext),
        String(state.row?.token_iv),
        owner,
      ),
    ).toBe("synthetic-first-token");
    const status = await GET();
    expect(await status.text()).not.toContain("token_ciphertext");
  });
  it("preserves the prior connection when replacement validation fails, then recovers with a valid replacement", async () => {
    await POST(request());
    const previous = structuredClone(state.row);
    vi.mocked(CanvasClient.prototype.identity).mockRejectedValueOnce(
      new CanvasApiError(401),
    );
    expect((await POST(request("synthetic-invalid-token"))).status).toBe(422);
    expect(state.row).toEqual(previous);
    expect((await POST(request("synthetic-replacement-token"))).status).toBe(
      200,
    );
    expect(
      decryptToken(
        String(state.row?.token_ciphertext),
        String(state.row?.token_iv),
        owner,
      ),
    ).toBe("synthetic-replacement-token");
    expect(new Set(state.tables)).toEqual(new Set(["canvas_connections"]));
  });
  it("rejects cross-origin attempts and enforces the persisted validation limit", async () => {
    expect(
      (await POST(request("synthetic-invalid-token", "https://evil.invalid")))
        .status,
    ).toBe(403);
    expect(CanvasClient.prototype.identity).not.toHaveBeenCalled();
    state.allowed = false;
    expect((await POST(request())).status).toBe(429);
    expect(state.row).toBeNull();
  });
  it("does not report success when the credential write fails", async () => {
    state.writeError = true;
    expect((await POST(request())).status).toBe(500);
    expect(state.row).toBeNull();
    expect(state.seed).not.toHaveBeenCalled();
  });
  it("rejects a replacement token for another Canvas student without replacing the prior credential", async () => {
    await POST(request());
    const previous = structuredClone(state.row);
    state.sameAccount = false;
    expect((await POST(request("synthetic-wrong-account-token"))).status).toBe(
      422,
    );
    expect(state.row).toEqual(previous);
  });
});
