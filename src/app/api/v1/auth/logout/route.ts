import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth";
import { supabase } from "@/lib/supabase/server";
import { checkMutation, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const db = await supabase();
    const { error } = await db.auth.signOut();
    if (error)
      throw new ApiError(502, "Sign-out could not be confirmed. Try again.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
