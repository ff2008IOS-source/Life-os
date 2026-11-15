import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./auth";
import { dbError } from "./http";
import { reviewAvailability } from "./temporal-context";
export async function requireSundayReview(
  db: SupabaseClient,
  user: string,
  period?: string,
  periodEnd?: string,
) {
  const profile = await db
    .from("profiles")
    .select("timezone")
    .eq("user_id", user)
    .maybeSingle();
  dbError(profile.error);
  const gate = reviewAvailability(
    new Date(),
    profile.data?.timezone || "America/Vancouver",
  );
  if (!gate.open)
    throw new ApiError(
      403,
      `Your weekly review opens on Sunday (${gate.timezone}).`,
      "REVIEW_CLOSED",
    );
  if (
    (period && period !== gate.weekStart) ||
    (periodEnd && periodEnd !== gate.weekEnd)
  )
    throw new ApiError(
      409,
      "This review is in your history. Start the current Sunday review to make new commitments.",
      "REVIEW_HISTORY",
    );
  return gate;
}
