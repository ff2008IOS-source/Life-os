import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverAdmin } from "@/lib/supabase/admin";
function key() {
  const value = process.env.CANVAS_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Canvas encryption configuration is unavailable");
  return Buffer.from(value, "hex");
}
export function encryptToken(token: string, owner: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  return {
    token_ciphertext: Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64"),
    token_iv: iv.toString("base64"),
  };
}
export function decryptToken(ciphertext: string, nonce: string, owner: string) {
  const raw = Buffer.from(ciphertext, "base64"),
    iv = Buffer.from(nonce, "base64");
  if (iv.length !== 12 || raw.length < 17)
    throw new Error("Invalid Canvas credential envelope");
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(raw.subarray(-16));
  return Buffer.concat([
    cipher.update(raw.subarray(0, -16)),
    cipher.final(),
  ]).toString("utf8");
}
export const canvasAdmin = serverAdmin;
