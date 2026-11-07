import "server-only";
import { CanvasClient, CanvasApiError, CANVAS_ORIGIN } from "./client";
export class CanvasFileHostError extends CanvasApiError {
  constructor(public hostname: string) {
    super(422, "Canvas returned an unsupported file host.");
  }
}
export const MAX_CANVAS_FILE_BYTES = 12 * 1024 * 1024;
export function trustedFileUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.hostname === "canvas.sfu.ca" ||
      url.hostname === "inst-fs-yul-prod.inscloudgate.net" ||
      url.hostname.endsWith(".instructureusercontent.com") ||
      /^a\d+-\d+\.cluster\d+\.canvas-user-content\.com$/.test(url.hostname) ||
      /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z]{2}-[a-z]+-\d)?\.amazonaws\.com$/.test(
        url.hostname,
      )
    )
  )
    throw new CanvasFileHostError(url.hostname);
  return url;
}
export async function boundedFileBody(
  response: Response,
  limit = MAX_CANVAS_FILE_BYTES,
) {
  if (Number(response.headers.get("content-length")) > limit)
    throw new CanvasApiError(
      413,
      "This file exceeds the extraction size limit.",
    );
  if (!response.body)
    throw new CanvasApiError(502, "Canvas returned an empty file.");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.byteLength;
      if (length > limit)
        throw new CanvasApiError(
          413,
          "This file exceeds the extraction size limit.",
        );
      parts.push(r.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}
export async function downloadCanvasFile(
  token: string,
  course: string,
  file: string,
  transport: typeof fetch = fetch,
) {
  if (!/^\d+$/.test(course) || !/^\d+$/.test(file))
    throw new CanvasApiError(422, "Invalid Canvas file identity.");
  const overall = AbortSignal.timeout(15000);
  const fetchWithin: typeof fetch = (input, init) =>
    transport(input, {
      ...init,
      signal: AbortSignal.any([
        overall,
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  const meta = (
    await new CanvasClient(token, fetchWithin).page(
      `courses/${course}/files/${file}`,
      {},
      true,
    )
  ).records[0];
  if (
    String(meta.id) !== file ||
    meta.locked_for_user === true ||
    meta.hidden_for_user === true
  )
    throw new CanvasApiError(403, "Canvas does not permit this file.");
  if (typeof meta.size === "number" && meta.size > MAX_CANVAS_FILE_BYTES)
    throw new CanvasApiError(
      413,
      "This file exceeds the extraction size limit.",
    );
  if (typeof meta.url !== "string")
    throw new CanvasApiError(502, "Canvas did not return a download address.");
  let url = trustedFileUrl(meta.url);
  for (let i = 0; i < 5; i++) {
    const response = await fetchWithin(url.href, {
      method: "GET",
      headers:
        url.origin === CANVAS_ORIGIN
          ? { Authorization: `Bearer ${token}` }
          : {},
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new CanvasApiError(502);
      url = trustedFileUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new CanvasApiError(response.status);
    const bytes = await boundedFileBody(response);
    return { bytes, metadata: meta };
  }
  throw new CanvasApiError(
    502,
    "Canvas file redirects exceeded the safety limit.",
  );
}
