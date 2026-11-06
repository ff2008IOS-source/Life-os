import "server-only";
import { randomUUID } from "node:crypto";
import { serverAdmin } from "./supabase/admin";
import { dbError } from "./http";
import { DEFAULT_POLICY, policySchema } from "./scheduler";
import { loadWorkspaceForUser } from "./services/workspace";
import { saveSchedulePreview } from "./services/scheduling";
import { applyReservations } from "./integrations/calendar-write-server";
export async function runSchedulingAutomation() {
  const db = serverAdmin();
  const settings = await db
    .from("scheduling_automation")
    .select("user_id,policy")
    .eq("enabled", true);
  dbError(settings.error);
  const summary = { checked: 0, reserved: 0, failed: 0 };
  for (const setting of settings.data ?? []) {
    const userId = setting.user_id;
    let jobId: string | undefined;
    try {
      const data = await loadWorkspaceForUser(userId);
      summary.checked++;
      const eligible = data.tasks.some(
        (t) =>
          !t.deleted_at &&
          !t.title.startsWith("[TEST]") &&
          !["completed", "cancelled"].includes(t.status) &&
          !!t.estimated_minutes &&
          (t.scheduling_mode === "eligible" ||
            data.projects.some(
              (p) =>
                p.id === t.project_id &&
                p.status === "active" &&
                p.automation_enabled,
            )),
      );
      if (!eligible) {
        await db
          .from("scheduling_automation")
          .update({
            last_checked_at: new Date().toISOString(),
            last_status: "idle",
            last_error: null,
          })
          .eq("user_id", userId);
        continue;
      }
      const deletion = await db
        .from("deletion_requests")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "requested")
        .limit(1);
      dbError(deletion.error);
      if (deletion.data?.length) continue;
      const key = `automation:${Math.floor(Date.now() / 900000)}`;
      const job = await db
        .from("integration_jobs")
        .insert({
          id: randomUUID(),
          user_id: userId,
          job_type: "scheduling_automation",
          idempotency_key: key,
          status: "running",
        })
        .select("id")
        .single();
      if (job.error?.code === "23505") continue;
      dbError(job.error);
      jobId = job.data!.id;
      const policy = policySchema.parse({
        ...DEFAULT_POLICY,
        ...setting.policy,
      });
      const preview = await saveSchedulePreview(policy, userId);
      if (preview.blocks.length) {
        const applied = await applyReservations(preview.run_id, userId);
        summary.reserved += applied.applied;
      }
      const update = await db
        .from("integration_jobs")
        .update({
          status: "completed",
          payload: {
            run_id: preview.run_id,
            proposed: preview.blocks.length,
            warnings: preview.warnings.length,
          },
        })
        .eq("id", jobId)
        .eq("user_id", userId);
      dbError(update.error);
      await db
        .from("scheduling_automation")
        .update({
          last_checked_at: new Date().toISOString(),
          last_status: preview.blocks.length ? "scheduled" : "no_space",
          last_error: null,
        })
        .eq("user_id", userId);
    } catch {
      summary.failed++;
      await db
        .from("scheduling_automation")
        .update({
          last_checked_at: new Date().toISOString(),
          last_status: "needs_attention",
          last_error:
            "Automatic planning stopped. Check calendar connection, available time or recent reservation runs.",
        })
        .eq("user_id", userId);
      if (jobId)
        await db
          .from("integration_jobs")
          .update({
            status: "failed",
            last_error:
              "Automatic planning needs review; existing reservations were preserved.",
          })
          .eq("id", jobId)
          .eq("user_id", userId);
    }
  }
  return summary;
}
