import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase/server";
import { encryptCredential } from "@/lib/integrations/credential-encryption";
export async function GET(request: Request) {
  const origin = process.env.LIFE_OS_APP_ORIGIN;
  if (!origin)
    return NextResponse.json(
      { error: { message: "Application origin is missing." } },
      { status: 503 },
    );
  try {
    const code = new URL(request.url).searchParams.get("code");
    if (!code) throw Error("Missing recovery code");
    const db = await supabase();
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    if (
      error ||
      !data.user ||
      data.user.email?.toLowerCase() !==
        process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
    )
      throw Error("Recovery verification failed");
    const { data: claims } = await db.auth.getClaims();
    const methods = claims?.claims.amr as { method?: string }[] | undefined;
    if (!methods?.some((m) => m.method === "recovery"))
      throw Error("Not a recovery session");
    const key = Buffer.from(process.env.LIFE_OS_CREDENTIAL_KEY ?? "", "base64");
    if (key.length !== 32) throw Error("Recovery encryption is not configured");
    const marker = encryptCredential(
      JSON.stringify({ expires: Date.now() + 600000 }),
      key,
      "recovery:" + data.user.id,
    );
    (await cookies()).set("life-os-password-recovery", marker, {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return NextResponse.redirect(new URL("/reset-password", origin));
  } catch {
    return NextResponse.redirect(
      new URL("/forgot-password?error=expired", origin),
    );
  }
}
