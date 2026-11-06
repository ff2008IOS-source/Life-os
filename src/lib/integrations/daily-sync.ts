import { timingSafeEqual } from "node:crypto";
export function validCronSecret(
  header: string | null,
  secret: string | undefined,
) {
  if (!secret || secret.length < 32 || !header) return false;
  const a = Buffer.from(header),
    b = Buffer.from("Bearer " + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export type DailyWork = { id: string; user_id: string; connection_id: string };
/** Sequential bounded work; never report a timed-out/skipped calendar as synced. */
export async function runDailyWork(
  calendars: DailyWork[],
  process: (calendar: DailyWork) => Promise<"completed" | "skipped">,
  clock = Date.now,
  budgetMs = 180000,
) {
  const start = clock();
  const summary = { completed: 0, failed: 0, skipped: 0, deferred: 0 };
  for (const calendar of calendars) {
    if (clock() - start > budgetMs) {
      summary.deferred++;
      continue;
    }
    try {
      summary[await process(calendar)]++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
