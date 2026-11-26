import "server-only";
import { z } from "zod";
import { ApiError } from "./auth";
import { AiUnavailable } from "./ai/structured";

/**
 * Reads a mark from a screenshot (Crowdmark has no student API, and its
 * emails don't include the score). Groq's free vision model only proposes
 * the numbers; the owner confirms before anything is saved.
 */
const reply = z.object({
  found: z.boolean(),
  earned: z.number().nonnegative().nullable(),
  maximum: z.number().positive().nullable(),
  assessment: z.string().max(200).nullable(),
});

export async function readMarkFromImage(image: string, hint: string | null) {
  if (!process.env.GROQ_API_KEY)
    throw new ApiError(
      503,
      "Screenshot reading isn't set up. Type the mark instead.",
    );
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:
        process.env.GROQ_VISION_MODEL ??
        "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0,
      max_completion_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You read a student\'s mark from a screenshot of a grading site such as Crowdmark or Canvas. Reply with JSON only: {"found": boolean, "earned": number|null, "maximum": number|null, "assessment": string|null}. "earned" is the total score received and "maximum" is the total possible (for "53.5 / 100" or "53.5%" give 53.5 and 100). Use the overall total, not a single question. If no total is visible, set found to false.',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: hint
                ? `The mark should be for "${hint.replace(/"/g, "'")}".`
                : "Read the overall mark.",
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
    cache: "no-store",
  }).catch(() => {
    throw new AiUnavailable("The screenshot couldn't be read.");
  });
  if (!r.ok)
    throw new ApiError(
      r.status === 429 ? 429 : 502,
      r.status === 429
        ? "The free AI limit is reached for now. Type the mark instead."
        : "The screenshot couldn't be read. Type the mark instead.",
    );
  const body = await r.json().catch(() => null);
  const content = body?.choices?.[0]?.message?.content;
  let parsed: ReturnType<typeof reply.safeParse> | null = null;
  try {
    if (typeof content === "string")
      parsed = reply.safeParse(
        JSON.parse(content.replace(/^```(?:json)?|```$/g, "")),
      );
  } catch {
    parsed = null;
  }
  if (!parsed?.success || !parsed.data.found || parsed.data.earned === null)
    return { found: false as const };
  const { earned, maximum, assessment } = parsed.data;
  if (maximum !== null && earned > maximum * 2)
    return { found: false as const };
  return { found: true as const, earned, maximum, assessment };
}
