import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  downloadCanvasFile,
  trustedFileUrl,
  boundedFileBody,
} from "../src/lib/canvas/file-download";
import {
  extractCanvasFile,
  chunkDocument,
} from "../src/lib/canvas/extract-file";
import { zipSync, strToU8 } from "fflate";
it("downloads only authorized file metadata, strips the bearer on CDN redirects and bounds the stream", async () => {
  const calls: { url: string; auth: unknown }[] = [];
  const fake = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        auth: (options?.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes("/api/v1/"))
        return new Response(
          JSON.stringify({
            id: 7,
            size: 9,
            url: "https://canvas.sfu.ca/files/7/download?verifier=synthetic",
          }),
        );
      if (url.includes("canvas.sfu.ca"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://sfu.instructureusercontent.com/file" },
        });
      return new Response("file text");
    },
  );
  const r = await downloadCanvasFile("synthetic-token", "55", "7", fake);
  expect(new TextDecoder().decode(r.bytes)).toBe("file text");
  expect(calls[0].auth).toBe("Bearer synthetic-token");
  expect(calls.at(-1)?.auth).toBeUndefined();
  await expect(
    boundedFileBody(new Response(new Uint8Array(20)), 10),
  ).rejects.toMatchObject({ status: 413 });
});
it("blocks arbitrary download hosts, hidden files and oversized metadata without fetching contents", async () => {
  expect(
    trustedFileUrl(
      "https://a27892-3544415.cluster222.canvas-user-content.com/file",
    ).hostname,
  ).toBe("a27892-3544415.cluster222.canvas-user-content.com");
  expect(() =>
    trustedFileUrl("https://canvas.sfu.ca.attacker.invalid/file"),
  ).toThrow();
  expect(() => trustedFileUrl("http://127.0.0.1/file")).toThrow();
  expect(
    trustedFileUrl(
      "https://canvas-files.s3.ca-central-1.amazonaws.com/course.pdf",
    ).hostname,
  ).toBe("canvas-files.s3.ca-central-1.amazonaws.com");
  expect(() =>
    trustedFileUrl(
      "https://canvas-files.s3.ca-central-1.amazonaws.com.attacker.invalid/a",
    ),
  ).toThrow();
  expect(() => trustedFileUrl("https://canvas.sfu.ca:8443/a")).toThrow();
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: 7,
          locked_for_user: true,
          url: "https://canvas.sfu.ca/files/7/download",
        }),
      ),
  );
  await expect(
    downloadCanvasFile("test", "55", "7", transport),
  ).rejects.toMatchObject({ status: 403 });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("extracts slide and document text in bounded workers without executing embedded document instructions", async () => {
  const zip = zipSync({
    "ppt/slides/slide2.xml": strToU8(
      "<p:sld><a:t>Inflation &amp; unemployment</a:t></p:sld>",
    ),
    "ppt/slides/slide1.xml": strToU8("<a:t>GDP accounting</a:t>"),
    "ppt/notesSlides/notesSlide1.xml": strToU8(
      "<a:t>Excluded private notes</a:t>",
    ),
  });
  const r = await extractCanvasFile(
    zip,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  expect(r.pages).toBe(2);
  expect(r.units.map((u) => u.text)).toEqual([
    "GDP accounting",
    "Inflation & unemployment",
  ]);
  expect(chunkDocument(r.units)[1].page).toBe(2);
  const doc = await extractCanvasFile(
    zipSync({
      "word/document.xml": strToU8("<w:t>Study the business cycle.</w:t>"),
    }),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  expect(doc.units[0].text).toContain("business cycle");
});
it("extracts actual PDF text and marks empty/image-only documents without fabricated text", async () => {
  const content =
    "BT /F1 12 Tf 72 720 Td (Macroeconomics: GDP and inflation) Tj ET";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const at = pdf.length;
  pdf +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${at}\n%%EOF`;
  const result = await extractCanvasFile(
    new TextEncoder().encode(pdf),
    "application/pdf",
  );
  expect(result.units[0].text).toContain("GDP and inflation");
  expect(result.pages).toBe(1);
  const empty = await extractCanvasFile(new Uint8Array(), "text/plain");
  expect(empty.units).toHaveLength(0);
});
