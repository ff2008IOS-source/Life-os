import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/auth";
export function serverAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new ApiError(
      503,
      "The server database connection is not configured.",
      "SETUP_REQUIRED",
    );
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
