import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, failure } from "@/lib/http";
import { decryptCredential } from "@/lib/integrations/credential-encryption";
import { verifyCurrentPassword } from "@/lib/password-security";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const input = z
      .object({
        password: z.string().min(12).max(128),
        confirm: z.string(),
        current_password: z.string().max(200).optional(),
      })
      .strict()
      .refine((x) => x.password === x.confirm, {
        message: "New passwords must match.",
      })
      .parse(await readJson(request));
    let recovery = false;
    const jar = await cookies();
    const marker = jar.get("life-os-password-recovery")?.value;
    if (marker)
      try {
        const key = Buffer.from(
          process.env.LIFE_OS_CREDENTIAL_KEY ?? "",
          "base64",
        );
        const value = z
          .object({ expires: z.number() })
          .parse(
            JSON.parse(decryptCredential(marker, key, "recovery:" + user.id)),
          );
        recovery = value.expires > Date.now();
      } catch {
        /* Invalid markers never authorize a password change. */
      }
    if (!recovery) {
      if (!input.current_password)
        throw new ApiError(
          401,
          "Enter your current password or use a valid recovery link.",
        );
      await verifyCurrentPassword(user.id, user.email!, input.current_password);
    }
    const { error } = await db.auth.updateUser({ password: input.password });
    if (error)
      throw new ApiError(
        422,
        "The new password was not accepted. Check your password policy or request a fresh recovery link.",
      );
    jar.delete("life-os-password-recovery");
    const logout = await db.auth.signOut({ scope: "global" });
    if (logout.error)
      throw new ApiError(
        502,
        "Your password changed, but session revocation could not be confirmed. Sign out again and review active sessions in Supabase.",
      );
    return NextResponse.json({ changed: true, sign_in_required: true });
  } catch (error) {
    return failure(error);
  }
}
