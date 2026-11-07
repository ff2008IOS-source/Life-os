import "server-only";
export const CANVAS_ORIGIN = "https://canvas.sfu.ca";
export class CanvasApiError extends Error {
  constructor(
    public readonly status: number,
    message = status === 404
      ? "Canvas could not find this resource. It may be hidden, removed or unavailable to this account."
      : status === 406
        ? "Canvas could not return this resource through the API. Other resources can still synchronize."
        : status === 504
          ? "Canvas did not respond before the request timeout. Previously imported information is preserved."
          : "Canvas could not be reached. Previously imported information is preserved.",
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}
export type CanvasRecord = Record<string, unknown>;
export type CanvasPage = { records: CanvasRecord[]; next: string | null };
export function canvasUrl(
  path: string,
  params: Record<string, string | string[]> = {},
) {
  const url = new URL(
    path.startsWith("https:") ? path : "/api/v1/" + path.replace(/^\/+/, ""),
    CANVAS_ORIGIN,
  );
  if (
    url.origin !== CANVAS_ORIGIN ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/api/v1/") ||
    url.hash
  )
    throw new CanvasApiError(422, "Untrusted Canvas resource address.");
  for (const [k, v] of Object.entries(params))
    for (const value of Array.isArray(v) ? v : [v])
      url.searchParams.append(k, value);
  return url;
}
export class CanvasClient {
  constructor(
    private readonly token: string,
    private readonly transport: typeof fetch = fetch,
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!token || /[\r\n]/.test(token))
      throw new CanvasApiError(422, "Invalid Canvas token.");
  }
  async page(
    path: string,
    params: Record<string, string | string[]> = {},
    single = false,
  ): Promise<CanvasPage> {
    const url = canvasUrl(path, params);
    if (!single && !url.searchParams.has("per_page"))
      url.searchParams.set("per_page", "50");
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.transport(url.href, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        if (attempt === 2) throw new CanvasApiError(504);
        await this.pause(250 * (attempt + 1));
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retry = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retry) && retry > 2)
          throw new CanvasApiError(
            429,
            "Canvas is limiting requests. Synchronization will retry later.",
          );
        await this.pause(
          Math.min(2000, Math.max(250, retry * 1000 || 250 * 2 ** attempt)),
        );
        continue;
      }
      if (!response.ok)
        throw new CanvasApiError(
          response.status,
          response.status === 401
            ? "Canvas authorization expired or was revoked. Replace the token."
            : response.status === 403
              ? "Canvas does not permit this resource. Other resources can still synchronize."
              : undefined,
        );
      const text = await response.text();
      if (text.length > 4_000_000)
        throw new CanvasApiError(
          413,
          "Canvas response exceeds the safe page limit.",
        );
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new CanvasApiError(502, "Canvas returned an invalid response.");
      }
      if (single) body = [body];
      if (
        !Array.isArray(body) ||
        body.some((x) => !x || typeof x !== "object" || Array.isArray(x))
      )
        throw new CanvasApiError(
          502,
          "Canvas returned an unexpected resource shape.",
        );
      const match = response.headers
        .get("link")
        ?.match(/<([^>]+)>;\s*rel="next"/);
      const next = match ? canvasUrl(match[1]).href : null;
      if (next === url.href)
        throw new CanvasApiError(
          502,
          "Canvas returned a repeated pagination cursor.",
        );
      return { records: body as CanvasRecord[], next };
    }
    throw new CanvasApiError(503);
  }
  async list(path: string, params: Record<string, string | string[]> = {}) {
    let next: string | null = canvasUrl(path, params).href;
    const result: CanvasRecord[] = [];
    const seen = new Set<string>();
    for (let i = 0; next && i < 100; i++) {
      if (seen.has(next))
        throw new CanvasApiError(502, "Canvas pagination loop detected.");
      seen.add(next);
      const page = await this.page(next);
      result.push(...page.records);
      next = page.next;
    }
    if (next) throw new CanvasApiError(413, "Canvas pagination limit reached.");
    return result;
  }
  async identity() {
    return (await this.page("users/self/profile", {}, true)).records[0];
  }
}
