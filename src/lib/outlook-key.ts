import "server-only";

/** Key for the short-lived sign-in cookie (the server's credential key). */
export function outlookCookieKey() {
  const value = process.env.CANVAS_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Encryption configuration is unavailable");
  return Buffer.from(value, "hex");
}
