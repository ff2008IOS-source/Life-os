import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dataset, Row } from "@/components/sheet-rest-panel";
export type SavedPlans = {
  datasets: Dataset[];
  overview: {
    dataset_id: string;
    rows: Row[];
    more: boolean;
    error?: string;
  }[];
};
export async function readSavedPlans(
  db: SupabaseClient,
  userId: string,
  sources: Dataset[],
  skillsOnly = false,
): Promise<SavedPlans> {
  const datasets = sources.filter(
    (source) =>
      !source.test_only &&
      source.mode !== "paused" &&
      (!skillsOnly ||
        source.config.columns.some((c) => /^skill$/i.test(c.header))),
  );
  const overview = await Promise.all(
    datasets.map(async (source) => {
      const result = await db
        .from("sheet_rest_rows")
        .select("id,version,local_values,state")
        .eq("user_id", userId)
        .eq("dataset_id", source.id)
        .order("id")
        .limit(26);
      return {
        dataset_id: source.id,
        rows: result.error ? [] : (result.data ?? []).slice(0, 25),
        more: (result.data?.length ?? 0) > 25,
        ...(result.error ? { error: "This section could not refresh." } : {}),
      };
    }),
  );
  return { datasets, overview } as SavedPlans;
}
