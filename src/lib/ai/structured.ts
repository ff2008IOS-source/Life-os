import { z } from "zod";

/**
 * Provider-neutral structured JSON calls. Life OS asks for a JSON object that
 * matches a zod schema; whichever free provider is configured answers. When
 * none is configured or the provider refuses, callers fall back to
 * deterministic logic. No paid fallback is ever used.
 */
export class AiUnavailable extends Error {}

type Provider = {
  name: string;
  available: () => boolean;
  call: (input: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
    name: string;
    maxTokens: number;
  }) => Promise<string>;
};

const groq: Provider = {
  name: "groq",
  available: () => !!process.env.GROQ_API_KEY,
  async call({ system, user, schema, name, maxTokens }) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name, strict: true, schema },
        },
      }),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      cache: "no-store",
    });
    if (!r.ok)
      throw new AiUnavailable(
        r.status === 429
          ? "The free AI limit is reached for now."
          : "The AI provider couldn’t answer.",
      );
    const body = await r.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new AiUnavailable("Empty AI reply.");
    return content;
  },
};

const providers: Provider[] = [groq];

export function aiConfigured() {
  return providers.some((p) => p.available());
}

export async function structuredJson<T extends z.ZodType>(input: {
  system: string;
  user: string;
  schema: T;
  name: string;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const provider = providers.find((p) => p.available());
  if (!provider) throw new AiUnavailable("No free AI provider is configured.");
  const raw = await provider.call({
    system: input.system,
    user: input.user,
    schema: z.toJSONSchema(input.schema) as Record<string, unknown>,
    name: input.name,
    maxTokens: input.maxTokens ?? 800,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiUnavailable("The AI reply wasn’t valid JSON.");
  }
  const result = input.schema.safeParse(parsed);
  if (!result.success) throw new AiUnavailable("The AI reply didn’t match.");
  return result.data;
}
