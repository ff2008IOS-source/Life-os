import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { checkMutation, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const db = await supabase();
    await db.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
