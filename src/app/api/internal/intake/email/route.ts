import { NextResponse } from "next/server";
import { z } from "zod";
import { failure } from "@/lib/http";
import { ingestEmails } from "@/lib/course-updates-server";

const body = z
  .object({
    emails: z
      .array(
        z.union([
          z
            .object({
              id: z.string().min(1).max(300),
              subject: z.string().max(1000),
              from: z.string().max(500),
              to: z.string().max(4000).optional(),
              date: z.string().max(100),
              body: z.string().max(40000),
            })
            .strict(),
          // An older email forwarded as an attachment (.eml source).
          z
            .object({
              id: z.string().min(1).max(300),
              raw: z.string().max(400000),
            })
            .strict(),
        ]),
      )
      .max(25),
  })
  .strict();

/**
 * Course emails from the owner's Google Apps Script. Authenticated with the
 * private token shown once in Settings; nothing else can post here.
 */
export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!/^lio_[A-Za-z0-9_-]{20,}$/.test(token))
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED" } },
        { status: 401 },
      );
    const text = await request.text();
    if (text.length > 1000000)
      return NextResponse.json(
        { error: { code: "TOO_LARGE" } },
        { status: 413 },
      );
    const result = await ingestEmails(
      token,
      body.parse(JSON.parse(text)).emails,
    );
    if (!result)
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED" } },
        { status: 401 },
      );
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
