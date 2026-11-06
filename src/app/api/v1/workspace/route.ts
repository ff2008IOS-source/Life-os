import { NextResponse } from "next/server";
import { loadWorkspace } from "@/lib/services/workspace";
import { failure } from "@/lib/http";
export async function GET() {
  try {
    return NextResponse.json(await loadWorkspace(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
