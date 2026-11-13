import { it, expect } from "vitest";
import { profileInput } from "@/lib/schemas";
import { validProfileImage } from "@/lib/profile-image";
it("accepts bounded raster data, rejects remote links, SVG, corrupt data and oversized images", () => {
  expect(validProfileImage("https://example.invalid/photo.jpg")).toBe(false);
  expect(validProfileImage("data:image/svg+xml;base64,PHN2Zy8+")).toBe(false);
  expect(validProfileImage("data:image/png;base64,ZmFrZQ==")).toBe(false);
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(192, 16);
  png.writeUInt32BE(192, 20);
  expect(
    validProfileImage("data:image/png;base64," + png.toString("base64")),
  ).toBe(true);
  png.writeUInt32BE(5000, 16);
  expect(
    validProfileImage("data:image/png;base64," + png.toString("base64")),
  ).toBe(false);
  expect(
    validProfileImage(
      "data:image/jpeg;base64," + Buffer.alloc(40000).toString("base64"),
    ),
  ).toBe(false);
});

it("preserves an existing photo when an older preferences form omits it", () => {
  const data = profileInput.parse({
    display_name: "Owner",
    theme: "dark",
    density: "comfortable",
  });
  expect(data.avatar_data_url).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain("avatar_data_url");
});
