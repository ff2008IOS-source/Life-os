import { it, expect, vi } from "vitest";
import type { WorkerOptions } from "node:worker_threads";
vi.mock("server-only", () => ({}));
const observed = vi.hoisted(() => ({
  environmentKeys: null as string[] | null,
  arguments: null as string[] | null,
}));
vi.mock("node:worker_threads", async (original) => {
  const actual = await original<typeof import("node:worker_threads")>();
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(file: string | URL, options?: WorkerOptions) {
        observed.environmentKeys =
          options?.env && typeof options.env === "object"
            ? Object.keys(options.env)
            : null;
        observed.arguments = options?.execArgv ?? null;
        super(file, options);
      }
    },
  };
});
import { extractCanvasFile } from "../src/lib/canvas/extract-file";
it("starts the real parser worker with no inherited server environment or launch arguments", async () => {
  process.env.LIFE_OS_SYNTHETIC_PARSER_SECRET = "synthetic-only";
  try {
    expect(
      (
        await extractCanvasFile(
          new TextEncoder().encode("Synthetic course material."),
          "text/plain",
        )
      ).units[0].text,
    ).toBe("Synthetic course material.");
    expect(observed.environmentKeys).toEqual([]);
    expect(observed.arguments).toEqual([]);
  } finally {
    delete process.env.LIFE_OS_SYNTHETIC_PARSER_SECRET;
  }
});
