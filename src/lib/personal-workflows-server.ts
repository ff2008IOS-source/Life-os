import "server-only";
import { serverAdmin } from "./supabase/admin";
import { dbError } from "./http";
import { eligibleWorkflow, workflowSetting } from "./personal-workflows";
export async function personalWorkflowWorker() {
  const db = serverAdmin();
  const settings = await db
    .from("personal_workflow_settings")
    .select("*")
    .eq("enabled", true)
    .limit(3);
  dbError(settings.error);
  if ((settings.data?.length ?? 0) > 2)
    throw Error("Personal workflow owner limit exceeded");
  const now = new Date();
  let prepared = 0;
  for (const row of settings.data ?? []) {
    const setting = workflowSetting.parse({
      workflow_type: row.workflow_type,
      enabled: row.enabled,
      run_time: String(row.run_time).slice(0, 5),
      weekday: row.weekday,
    });
    const due = eligibleWorkflow(setting, now);
    const existing = await db
      .from("personal_workflow_runs")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("run_key", due.key)
      .maybeSingle();
    dbError(existing.error);
    if (existing.data) continue;
    const result = await db.rpc("prepare_personal_workflow", {
      p_user: row.user_id,
      p_type: setting.workflow_type,
      p_key: due.key,
      p_scheduled: due.scheduled_for,
      p_now: now.toISOString(),
    });
    dbError(result.error);
    prepared++;
  }
  return { prepared };
}
