import { createHash } from "node:crypto";
import { norm } from "./workbook";

/** Stable hashing and keys for the career import (pure, testable). */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .filter((k) => !k.startsWith("_"))
          .sort()
          .map(
            (k) =>
              `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
          )
          .join(",")}}`
      : JSON.stringify(v ?? null);
export const hashOf = (v: unknown) =>
  createHash("sha256").update(stable(v)).digest("hex").slice(0, 32);

/** The new stable key for a row of the Nov 6 snapshot. */
export function legacyKey(
  sourceKey: string | null,
  kind: string,
): string | null {
  if (!sourceKey?.startsWith("[")) return null;
  let a: unknown[];
  try {
    a = JSON.parse(sourceKey);
  } catch {
    return null;
  }
  const tab = Number(a[1]);
  const parts = a.slice(3).map(String);
  const last = parts.at(-1) ?? "";
  if (kind === "application_target") return `wb:employer:${norm(last)}`;
  if (kind === "skill") return `wb:skill:${norm(last)}`;
  if (kind === "portfolio_project") {
    const m = last.match(/^milestone\s*(\d+)/i);
    return m ? `wb:portfolio:milestone-${m[1]}` : `wb:portfolio:${norm(last)}`;
  }
  if (kind === "career_goal" && parts.length >= 3)
    return `wb:semester:${norm(parts[0])}:${norm(parts[1])}:${norm(parts[2])}`;
  if (kind === "roadmap" && tab === 339115308)
    return `wb:year:${norm(parts[0])}`;
  if (kind === "roadmap" && tab === 1556875099)
    return `wb:coop:${norm(parts[0])}`;
  if (kind === "contact") return `wb:contact:${norm(last)}`;
  if (kind === "review") return `wb:review:${parts[0]}`;
  return null;
}
