import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/server";
import { checkMutation, readJson, failure } from "@/lib/http";
import { ApiError } from "@/lib/auth";
import { trustRememberedDevice } from "@/lib/trusted-device";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { email, password } = z
      .object({ email: z.email(), password: z.string().min(1).max(200) })
      .strict()
      .parse(await readJson(request));
    if (
      email.toLowerCase() !== process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
    )
      throw new ApiError(401, "Unable to sign in with these credentials.");
    const db = await supabase();
    const { data: login, error } = await db.auth.signInWithPassword({
      email,
      password,
    });
    if (error)
      throw new ApiError(
        error.status === 429 ? 429 : 401,
        "Unable to sign in. Check credentials or try again later.",
      );
    if (
      login.user?.factors?.some((f) => f.status === "verified") &&
      !(await trustRememberedDevice(db))
    )
      return NextResponse.json({ ok: true, mfa_required: true });
    const { data: approved } = await db.rpc("is_approved_user");
    if (!approved) {
      await db.auth.signOut();
      throw new ApiError(403, "Account provisioning is incomplete.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
