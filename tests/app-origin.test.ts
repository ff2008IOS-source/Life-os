import { describe, expect, it } from "vitest";
import { applicationOrigin, permittedApplicationOrigins } from "../src/lib/app-origin";

describe("Vercel preview mutation origin allowlist", () => {
  const preview = {
    VERCEL_ENV: "preview",
    VERCEL_URL: "lifeos-abcd-ios13.vercel.app",
    VERCEL_BRANCH_URL: "lifeos-git-fix-canvas-parser-boundaries-ios13.vercel.app",
    LIFE_OS_APP_ORIGIN: "https://lifeos-beta-ivory.vercel.app",
  };

  it("accepts both the immutable deployment and its Vercel-issued branch alias", () => {
    expect(applicationOrigin(preview)).toBe("https://lifeos-abcd-ios13.vercel.app");
    expect(permittedApplicationOrigins(preview)).toEqual([
      "https://lifeos-abcd-ios13.vercel.app",
      "https://lifeos-git-fix-canvas-parser-boundaries-ios13.vercel.app",
    ]);
  });

  it("does not accept arbitrary Vercel hosts, forged URLs, or a production origin on preview", () => {
    const allowed = permittedApplicationOrigins(preview);
    expect(allowed).not.toContain("https://another-app.vercel.app");
    expect(allowed).not.toContain("https://lifeos-beta-ivory.vercel.app");
    const poisoned = {
      ...preview,
      VERCEL_BRANCH_URL: "lifeos-git-fix.vercel.app.evil.invalid",
    };
    expect(permittedApplicationOrigins(poisoned)).toEqual([
      "https://lifeos-abcd-ios13.vercel.app",
    ]);
    expect(
      permittedApplicationOrigins({ ...preview, VERCEL_BRANCH_URL: "evil.vercel.app/attack" }),
    ).toHaveLength(1);
  });

  it("keeps production locked to the configured production origin only", () => {
    const env = { ...preview, VERCEL_ENV: "production" };
    expect(permittedApplicationOrigins(env)).toEqual([
      "https://lifeos-beta-ivory.vercel.app",
    ]);
  });

  it("does not silently enable CSRF checks without trusted configuration", () => {
    expect(permittedApplicationOrigins({ VERCEL_ENV: "preview" })).toEqual([]);
  });
});
