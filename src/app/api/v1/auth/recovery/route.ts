import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/server";
import { checkMutation, readJson, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { email } = z
      .object({ email: z.email() })
      .strict()
      .parse(await readJson(request));
    if (
      email.toLowerCase() === process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
    ) {
      const db = await supabase();
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: process.env.LIFE_OS_APP_ORIGIN + "/auth/recovery",
      });
      if (error)
        console.warn("Password recovery email request could not complete", {
          code: error.code ?? "AUTH_ERROR",
        });
    }
    // Same response for unapproved addresses and delivery failures: never disclose identities.
    return NextResponse.json({
      message:
        "If this is the approved account and email delivery is configured, a recovery link will arrive. If no email arrives, contact the project owner to check Supabase email settings.",
    });
  } catch (error) {
    return failure(error);
  }
}
