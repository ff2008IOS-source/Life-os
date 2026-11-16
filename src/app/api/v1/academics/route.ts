import { readAcademics } from "@/lib/services/academics";
import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await authorized();
    return NextResponse.json(await readAcademics(db, user.id));
  } catch (error) {
    return failure(error);
  }
}
