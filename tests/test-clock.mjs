// Test runner preload only. Never imported by application source or production builds.
const NativeDate = Date;
const started = Number(
  process.env.LIFE_OS_TEST_CLOCK_ORIGIN ?? NativeDate.now(),
);
export const sunday = NativeDate.parse("2026-11-15T20:00:00Z");
globalThis.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [sunday + NativeDate.now() - started]));
  }
  static parse(value) {
    return NativeDate.parse(value);
  }
  static UTC(...args) {
    return NativeDate.UTC(...args);
  }
  static now() {
    return sunday + NativeDate.now() - started;
  }
};
// Intercept only the synthetic Groq request issued by the test web server.
const networkFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (
    (url instanceof Request ? url.url : String(url)) ===
      "https://api.groq.com/openai/v1/chat/completions" &&
    new Headers(
      init?.headers ?? (url instanceof Request ? url.headers : undefined),
    ).get("authorization") === "Bearer synthetic-topics-key"
  ) {
    const request = JSON.parse(
      typeof init?.body === "string"
        ? init.body
        : await new Response(init?.body ?? url.body).text(),
    );
    if (!request.messages[1].content.includes("Synaptic pruning"))
      throw Error("Unexpected synthetic Groq request");
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              topics: [
                {
                  title: "Synaptic pruning",
                  section: "Ch. 10",
                  source_file: "Lecture 10.pdf",
                },
              ],
            }),
          },
        },
      ],
      usage: { total_tokens: 140 },
    });
  }
  return networkFetch(url, init);
};
