import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionIdentity, authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await sessionIdentity();
    const { data, error } = await db.auth.getClaims();
    if (error) throw new ApiError(401, "Sign in again.");
    return NextResponse.json({
      factors: (user.factors ?? [])
        .filter((f) => f.factor_type === "totp")
        .map((f) => ({
          id: f.id,
          status: f.status,
          name: f.friendly_name ?? "Authenticator",
        })),
      assurance: data?.claims.aal ?? "aal1",
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await sessionIdentity();
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("enroll") }).strict(),
        z
          .object({
            action: z.literal("verify"),
            factor_id: z.uuid(),
            code: z.string().regex(/^\d{6}$/),
          })
          .strict(),
        z.object({ action: z.literal("remove"), factor_id: z.uuid() }).strict(),
      ])
      .parse(await readJson(request));
    if (input.action === "enroll") {
      await authorized();
      const { data, error } = await db.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Life OS authenticator",
        issuer: "Life OS",
      });
      if (error)
        throw new ApiError(
          422,
          "Authenticator enrollment could not start. Check existing factors or try again.",
        );
      return NextResponse.json({
        id: data.id,
        qr_code: data.totp.qr_code,
        secret: data.totp.secret,
      });
    }
    const factor = user.factors?.find(
      (f) => f.id === input.factor_id && f.factor_type === "totp",
    );
    if (!factor) throw new ApiError(404, "Authenticator not found.");
    if (input.action === "remove") {
      if (factor.status === "verified") await authorized();
      const { error } = await db.auth.mfa.unenroll({ factorId: factor.id });
      if (error)
        throw new ApiError(
          422,
          "Verify your authenticator code before removing the factor.",
        );
      return NextResponse.json({ removed: true });
    }
    const { error } = await db.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: input.code,
    });
    if (error)
      throw new ApiError(
        422,
        "The authenticator code was not accepted. Use the current six-digit code.",
      );
    await authorized();
    return NextResponse.json({ verified: true });
  } catch (error) {
    return failure(error);
  }
}
