import "server-only";
import { canvasHealth } from "./health";
import { randomUUID } from "node:crypto";
import { canvasAdmin, decryptToken } from "./secure";
import { CanvasClient, CanvasApiError, canvasUrl } from "./client";
import {
  children,
  normalized,
  resourceId,
  coursesJob,
  expiryWarning,
} from "./resources";
import { ApiError } from "@/lib/auth";
import { dbError } from "@/lib/http";
const checked = <
  T extends { error: { code?: string; message?: string } | null },
>(
  x: T,
) => {
  dbError(x.error);
  return x;
};
export async function seedCanvas(user: string) {
  const j = coursesJob();
  checked(
    await canvasAdmin().from("canvas_sync_jobs").upsert(
      {
        user_id: user,
        job_key: j.key,
        resource_type: j.type,
        path: j.path,
        params: j.params,
        interval_minutes: j.minutes,
        priority: 0,
      },
      { onConflict: "user_id,job_key", ignoreDuplicates: true },
    ),
  );
}
// Discover links from already imported modules without fetching an index Canvas may deny.
// Every discovered resource still requires its own authorized Canvas GET.
export async function seedModuleLinks(user: string) {
  const db = canvasAdmin();
  for (let page = 0; page < 10; page++) {
    const result = checked(
      await db
        .from("canvas_records")
        .select("canvas_id,course_canvas_id,payload")
        .eq("user_id", user)
        .eq("resource_type", "module_item")
        .order("canvas_id")
        .range(page * 500, page * 500 + 499),
    );
    const rows = result.data ?? [];
    const specs = rows.flatMap((r) =>
      children("module_item", r.payload, r.course_canvas_id),
    );
    const unique = [...new Map(specs.map((j) => [j.key, j])).values()];
    for (let offset = 0; offset < unique.length; offset += 100)
      checked(
        await db.from("canvas_sync_jobs").upsert(
          unique.slice(offset, offset + 100).map((j) => ({
            user_id: user,
            job_key: j.key,
            resource_type: j.type,
            path: j.path,
            params: j.params,
            course_canvas_id: j.course,
            single_resource: j.single,
            interval_minutes: j.minutes,
          })),
          { onConflict: "user_id,job_key", ignoreDuplicates: true },
        ),
      );
    if (rows.length < 500) return;
  }
  throw new ApiError(
    422,
    "Module-link discovery reached its safety limit. Existing imports and jobs are preserved.",
  );
}
export async function canvasStatus(user: string) {
  const db = canvasAdmin();
  const [connection, jobs, mappings] = await Promise.all([
    db
      .from("canvas_connections")
      .select("expires_at,last_sync_at,last_attempt_at,last_error,enabled")
      .eq("user_id", user)
      .maybeSingle(),
    db
      .from("canvas_sync_jobs")
      .select(
        "job_key,resource_type,interval_minutes,last_success_at,last_error,next_run_at,next_url",
      )
      .eq("user_id", user)
      .order("job_key")
      .limit(501),
    db
      .from("canvas_mappings")
      .select("resource_type,canvas_id,local_id,conflict")
      .eq("user_id", user)
      .not("conflict", "is", null)
      .limit(51),
  ]);
  [connection, jobs, mappings].forEach(checked);
  const health = canvasHealth(jobs.data ?? []);
  return {
    health,
    connected: !!connection.data,
    connection: connection.data,
    warning: connection.data?.expires_at
      ? expiryWarning(connection.data.expires_at)
      : null,
    resources: jobs.data?.slice(0, 500) ?? [],
    resources_truncated: (jobs.data?.length ?? 0) > 500,
    conflicts: mappings.data?.slice(0, 50) ?? [],
    conflicts_truncated: (mappings.data?.length ?? 0) > 50,
    stale: !connection.data?.last_sync_at || health.academic_stale_count > 0,
  };
}
export async function syncCanvas(
  user: string,
  { manual = false, discover = false, limit = 3 } = {},
) {
  const db = canvasAdmin(),
    lease = randomUUID();
  const claim = checked(
    await db.rpc("canvas_claim", { p_user: user, p_token: lease }),
  );
  if (!claim.data)
    throw new ApiError(
      409,
      "Canvas is paused, expired or already synchronizing. Check the connection and retry shortly.",
    );
  const connection = checked(
    await db
      .from("canvas_connections")
      .select("token_ciphertext,token_iv,generation,expires_at")
      .eq("user_id", user)
      .single(),
  ).data!;
  let processed = 0;
  const errors: string[] = [];
  try {
    const canvas = new CanvasClient(
      decryptToken(connection.token_ciphertext, connection.token_iv, user),
    );
    await seedCanvas(user);
    if (discover) await seedModuleLinks(user);
    if (manual)
      checked(await db.rpc("canvas_request_refresh", { p_user: user }));
    const jobs =
      checked(
        await db
          .from("canvas_sync_jobs")
          .select("*")
          .eq("user_id", user)
          .lte("next_run_at", new Date().toISOString())
          .order("priority")
          .order("next_run_at")
          .order("job_key")
          .limit(limit),
      ).data ?? [];
    const started = Date.now();
    for (const j of jobs) {
      if (Date.now() - started > 18000) break;
      try {
        if (j.page_count >= 100)
          throw new CanvasApiError(
            413,
            "Canvas pagination limit reached; review this resource before retrying.",
          );
        const current = canvasUrl(
          j.next_url ?? j.path,
          j.next_url ? {} : j.params,
        ).href;
        if (j.seen_urls.includes(current))
          throw new CanvasApiError(
            502,
            "Canvas pagination repeated a previously imported page.",
          );
        const page = await canvas.page(current, {}, j.single_resource);
        const records = page.records
          .filter(
            (p) => j.resource_type !== "page_content" || p.published !== false,
          )
          .map((p) => ({
            type: j.resource_type,
            id: resourceId(j.resource_type, p, j.course_canvas_id),
            course: j.course_canvas_id,
            payload: p,
            normalized: normalized(j.resource_type, p),
          }));
        const enqueue = page.records.flatMap((p) =>
          children(j.resource_type, p, j.course_canvas_id),
        );
        checked(
          await db.rpc("canvas_store_page", {
            p_user: user,
            p_lease: lease,
            p_generation: connection.generation,
            p_job: j.job_key,
            p_records: records,
            p_next: page.next,
            p_current: current,
            p_children: enqueue,
          }),
        );
        processed += records.length;
      } catch (e) {
        const status = e instanceof CanvasApiError ? e.status : 500;
        const message =
          e instanceof CanvasApiError
            ? `${e.message} (Canvas HTTP ${e.status})`
            : "This Canvas resource could not be validated or saved. Its cursor was preserved for retry.";
        errors.push(message);
        checked(
          await db
            .from("canvas_sync_jobs")
            .update({
              last_error: message,
              attempts: j.attempts + 1,
              next_run_at: new Date(
                Date.now() +
                  Math.min(360, 5 * 2 ** Math.min(j.attempts, 6)) * 60000,
              ).toISOString(),
            })
            .eq("user_id", user)
            .eq("job_key", j.job_key),
        );
        checked(
          await db
            .from("canvas_connections")
            .update({
              last_error: message,
              ...(status === 401 ? { enabled: false } : {}),
            })
            .eq("user_id", user)
            .eq("generation", connection.generation),
        );
        if (status === 401) break;
      }
    }
  } finally {
    checked(
      await db
        .from("canvas_connections")
        .update({ lease_token: null, lease_until: null })
        .eq("user_id", user)
        .eq("lease_token", lease),
    );
  }
  const pending =
    checked(
      await db
        .from("canvas_sync_jobs")
        .select("job_key", { count: "exact", head: true })
        .eq("user_id", user)
        .lte("next_run_at", new Date().toISOString()),
    ).count ?? 0;
  return { processed, pending, errors };
}
export async function canvasWorker() {
  const db = canvasAdmin(),
    now = Date.now();
  const rows =
    checked(
      await db
        .from("canvas_connections")
        .select("user_id,expires_at,enabled")
        .limit(2),
    ).data ?? [];
  // Single-owner product; never silently fan out an unbounded service-role sweep.
  if (rows.length > 1) throw Error("Canvas worker owner limit exceeded");
  const outcomes = [];
  for (const row of rows) {
    const approved = checked(
      await db.rpc("canvas_worker_owner", { p_user: row.user_id }),
    );
    if (!approved.data) continue;
    if (row.enabled && Date.parse(row.expires_at) > now) {
      try {
        outcomes.push(await syncCanvas(row.user_id, { limit: 20 }));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
      }
    }
  }
  return outcomes;
}
