/** Raster data only. Never fetch a remote URL or allow SVG/HTML profile uploads. */
export function validProfileImage(value: string) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(
    value,
  );
  if (!match || value.length > 45000) return false;
  const b = Buffer.from(match[2], "base64");
  if (b.length > 32768 || b.length < 16 || b.toString("base64") !== match[2])
    return false;
  if (match[1] === "jpeg")
    return (
      b[0] === 255 &&
      b[1] === 216 &&
      b[2] === 255 &&
      b[b.length - 2] === 255 &&
      b[b.length - 1] === 217
    );
  if (match[1] === "png")
    return (
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.length >= 24 &&
      b.readUInt32BE(16) <= 512 &&
      b.readUInt32BE(20) <= 512
    );
  return (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  );
}
