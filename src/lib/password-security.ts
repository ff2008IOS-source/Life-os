import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/auth";
/** Verify the password with an isolated client so an AAL2 session is not downgraded. */
export async function verifyCurrentPassword(
  userId: string,
  email: string,
  password: string,
) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || data.user?.id !== userId)
    throw new ApiError(
      401,
      "The current password could not be verified.",
      "REAUTHENTICATION_REQUIRED",
    );
  await client.auth.signOut({ scope: "local" });
}
