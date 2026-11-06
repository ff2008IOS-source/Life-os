import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { checkMutation, dbError, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const { error } = await db.rpc("add_beta_examples");
    dbError(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
