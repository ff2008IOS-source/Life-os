import { validProfileImage } from "@/lib/profile-image";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { profileInput } from "@/lib/schemas";
export async function PATCH(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const body = z
      .object({ version: z.number().int().positive(), data: profileInput })
      .strict()
      .parse(await readJson(request));
    if (
      body.data.avatar_data_url &&
      !validProfileImage(body.data.avatar_data_url)
    )
      throw new ApiError(
        422,
        "Choose a valid PNG, JPEG or WebP profile image under 32 KB after resizing.",
      );
    const { data, error } = await db
      .from("profiles")
      .update(body.data)
      .eq("user_id", user.id)
      .eq("version", body.version)
      .select()
      .maybeSingle();
    dbError(error);
    if (!data) throw new ApiError(409, "Profile changed. Refresh first.");
    return NextResponse.json({ data });
  } catch (e) {
    return failure(e);
  }
}
