import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applicationOrigin } from "@/lib/app-origin";

/**
 * "Remember this device for 14 days" for two-step sign-in. The browser
 * keeps a random token in an httpOnly cookie; the database keeps only its
 * hash and the fixed end date. A password sign-in that presents the token
 * skips the authenticator code until then.
 */
export const DEVICE_COOKIE = "lifeos_device";
export const REMEMBER_DAYS = 14;
/**
 * The same token in a request header, for Claude's automated checks: the
 * owner creates it in Settings and stores it in the environment's secure
 * settings, which add it to requests. It is one more remembered device.
 */
export const DEVICE_HEADER = "x-lifeos-device-token";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** After a verified code: remember this browser. Returns the end date. */
export async function rememberDevice(db: SupabaseClient) {
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db.rpc("remember_this_device", {
    p_hash: hash(token),
  });
  if (error || !data) return null;
  (await cookies()).set(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: applicationOrigin()?.startsWith("https:") ?? false,
    path: "/",
    maxAge: REMEMBER_DAYS * 86400,
  });
  return String(data);
}

/** A key for Claude's checks: a remembered device whose token is shown once. */
export async function createCheckerKey(db: SupabaseClient) {
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db.rpc("remember_this_device", {
    p_hash: hash(token),
  });
  if (error || !data) return null;
  return { key: token, until: String(data) };
}

/** On password sign-in: is this a remembered device? Trusts the new session if so. */
export async function trustRememberedDevice(db: SupabaseClient) {
  const token =
    (await cookies()).get(DEVICE_COOKIE)?.value ??
    (await headers()).get(DEVICE_HEADER) ??
    undefined;
  if (!token || !TOKEN.test(token)) return null;
  const { data, error } = await db.rpc("trust_this_session", {
    p_hash: hash(token),
  });
  return error || !data ? null : String(data);
}

export async function forgetDevices(db: SupabaseClient) {
  const { error } = await db.rpc("forget_remembered_devices");
  (await cookies()).delete(DEVICE_COOKIE);
  return !error;
}
