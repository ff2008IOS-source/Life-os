import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
/** Server-only primitive. Key must be managed separately from database backups. */
export function encryptCredential(
  payload: string,
  key: Buffer,
  context: string,
) {
  if (key.length !== 32) throw Error("A 256-bit encryption key is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}
export function decryptCredential(
  envelope: string,
  key: Buffer,
  context: string,
) {
  const value = JSON.parse(envelope) as {
    v: number;
    iv: string;
    tag: string;
    data: string;
  };
  if (value.v !== 1 || key.length !== 32)
    throw Error("Unsupported credential envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
