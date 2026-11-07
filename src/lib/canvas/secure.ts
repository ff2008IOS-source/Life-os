import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function key() {
  const value = process.env.CANVAS_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("CANVAS_ENCRYPTION_KEY must be 32 bytes of hex");
  return Buffer.from(value, "hex");
}
export function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { token_ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64"), token_iv: iv.toString("base64") };
}
export function decryptToken(ciphertext: string, nonce: string) {
  const raw = Buffer.from(ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonce, "base64"));
  decipher.setAuthTag(raw.subarray(-16));
  return Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]).toString("utf8");
}
export function canvasAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Canvas server configuration incomplete");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
