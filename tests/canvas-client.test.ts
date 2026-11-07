import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { CanvasClient, canvasUrl } from "../src/lib/canvas/client";
import { encryptToken, decryptToken } from "../src/lib/canvas/secure";
import {
  normalized,
  children,
  expiryWarning,
  resourceId,
} from "../src/lib/canvas/resources";
import { applicationOrigin } from "../src/lib/app-origin";
afterEach(() => vi.unstubAllEnvs());
describe("Canvas read-only client and credential boundary", () => {
  it("follows trusted pagination and supplies only GET bearer requests", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('[{"id":1}]', {
          headers: {
            link: '<https://canvas.sfu.ca/api/v1/courses?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('[{"id":2}]'));
    const client = new CanvasClient("synthetic-token", send);
    expect(await client.list("courses")).toHaveLength(2);
    expect(send.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
    });
  });
  it("rejects credential exfiltration through next links or arbitrary origins", async () => {
    expect(() => canvasUrl("https://evil.invalid/api/v1/courses")).toThrow();
    const client = new CanvasClient(
      "synthetic-token",
      vi.fn().mockResolvedValue(
        new Response("[]", {
          headers: {
            link: '<https://evil.invalid/api/v1/courses>; rel="next"',
          },
        }),
      ),
    );
    await expect(client.list("courses")).rejects.toThrow(/Untrusted/);
  });
  it("bounds rate limit retries and honors long retry-after without sleeping", async () => {
    const send = vi
        .fn()
        .mockResolvedValue(
          new Response("", { status: 429, headers: { "retry-after": "60" } }),
        ),
      wait = vi.fn();
    await expect(
      new CanvasClient("synthetic-token", send, wait).page("courses"),
    ).rejects.toMatchObject({ status: 429 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
  it("retries transient errors and does not retry revoked authorization", async () => {
    const wait = vi.fn().mockResolvedValue(undefined),
      send = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 500 }))
        .mockResolvedValueOnce(new Response("[]"));
    expect(
      (await new CanvasClient("synthetic-token", send, wait).page("courses"))
        .records,
    ).toEqual([]);
    expect(wait).toHaveBeenCalledTimes(1);
    const denied = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(
      new CanvasClient("synthetic-token", denied, wait).page("courses"),
    ).rejects.toMatchObject({ status: 401 });
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed provider data and repeated pagination cursors", async () => {
    await expect(
      new CanvasClient(
        "synthetic-token",
        vi.fn().mockResolvedValue(new Response("{}")),
      ).page("courses"),
    ).rejects.toThrow(/unexpected/);
    await expect(
      new CanvasClient(
        "synthetic-token",
        vi.fn().mockResolvedValue(
          new Response("[]", {
            headers: {
              link: '<https://canvas.sfu.ca/api/v1/courses?per_page=50>; rel="next"',
            },
          }),
        ),
      ).page("courses"),
    ).rejects.toThrow(/repeated/);
  });
  it("encrypts with a random IV, authenticates ownership and rejects corruption", () => {
    vi.stubEnv("CANVAS_ENCRYPTION_KEY", "11".repeat(32));
    const a = encryptToken("synthetic-token", "owner"),
      b = encryptToken("synthetic-token", "owner");
    expect(a.token_ciphertext).not.toBe(b.token_ciphertext);
    expect(decryptToken(a.token_ciphertext, a.token_iv, "owner")).toBe(
      "synthetic-token",
    );
    expect(() =>
      decryptToken(a.token_ciphertext, a.token_iv, "other"),
    ).toThrow();
    expect(() => decryptToken("AAAA", a.token_iv, "owner")).toThrow();
  });
  it("keeps missing grades unknown and does not invent completion or weighted totals", () => {
    expect(
      normalized("assignment", {
        name: "[TEST] Quiz",
        points_possible: 10,
        due_at: null,
        submission: { workflow_state: "unsubmitted", score: null },
      }),
    ).toMatchObject({ earned_score: null, submission_state: "not_submitted" });
    expect(
      normalized("assignment", {
        name: "[TEST] Zero",
        points_possible: 0,
        submission: { score: 0 },
      }),
    ).toMatchObject({ earned_score: null, maximum_score: null });
  });
  it("uses actual enrollment term, scoped identities and published page contents only", () => {
    expect(
      normalized("course", {
        id: 1,
        name: "[TEST] Course",
        course_code: "ECON113 D100",
        term: { name: "2026 Fall" },
      }),
    ).toMatchObject({ code: "ECON113", term: "2026 Fall" });
    expect(
      children("page", { page_id: 1, url: "draft", published: false }, "1"),
    ).toEqual([]);
    expect(resourceId("page", { page_id: 2 }, "1")).toBe("1:2");
    expect(
      resourceId("submission", { assignment_id: 2, user_id: 3 }, "1"),
    ).toBe("1:2:3");
  });
  it("calculates expiry thresholds without assuming a month is unlimited", () => {
    const now = Date.parse("2026-11-07T12:00Z");
    expect(expiryWarning("2026-11-14T12:00Z", now)).toBe(7);
    expect(expiryWarning("2026-11-10T12:00Z", now)).toBe(3);
    expect(expiryWarning("2026-11-08T12:00Z", now)).toBe(1);
    expect(expiryWarning("2026-11-07T12:00Z", now)).toBe(0);
  });
  it("uses platform preview origin and fails closed on an untrusted host", () => {
    expect(
      applicationOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "lifeos-test.vercel.app",
        LIFE_OS_APP_ORIGIN: "https://lifeos-beta-ivory.vercel.app",
      }),
    ).toBe("https://lifeos-test.vercel.app");
    expect(
      applicationOrigin({ VERCEL_ENV: "preview", VERCEL_URL: "evil.invalid" }),
    ).toBeUndefined();
  });
});
