import { NextResponse } from "next/server";
import { validCronSecret } from "@/lib/integrations/daily-sync";
import { serverAdmin } from "@/lib/supabase/admin";
import { dbError, failure } from "@/lib/http";
export async function POST(request: Request) {
  if (
    !validCronSecret(
      request.headers.get("authorization"),
      process.env.NOTIFICATION_WORKER_SECRET,
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { data, error } = await serverAdmin().rpc(
      "configure_notification_timer",
      { p_secret: process.env.NOTIFICATION_WORKER_SECRET },
    );
    dbError(error);
    return NextResponse.json({ configured: data === true });
  } catch (e) {
    return failure(e);
  }
}
