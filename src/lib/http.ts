import { applicationOrigin } from "./app-origin";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./auth";
export function checkMutation(request: Request) {
  const origin = request.headers.get("origin");
  const expected = applicationOrigin();
  if (!expected)
    throw new ApiError(
      503,
      "Configure the application origin before making changes.",
      "SETUP_REQUIRED",
    );
  if (!origin || origin !== expected)
    throw new ApiError(
      403,
      "Request origin could not be verified.",
      "INVALID_ORIGIN",
    );
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 65536) throw new ApiError(413, "Request is too large.");
}
export async function readJson(request: Request, maxBytes = 65536) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes)
    throw new ApiError(413, "Request is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues.map((i) => i.message).join(" "),
        },
      },
      { status: 422 },
    );
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  console.error(
    "Life OS request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed. Try again.",
      },
    },
    { status: 500 },
  );
}
export function dbError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new ApiError(409, "This record already exists.", "DUPLICATE");
  if (error.code === "23503")
    throw new ApiError(
      422,
      "A linked record is missing or belongs to another account.",
    );
  if (error.code === "23514")
    throw new ApiError(422, "The change violates a record constraint.");
  throw new ApiError(
    500,
    "The database operation failed. Check setup and try again.",
  );
}
