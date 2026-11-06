import { createHmac, timingSafeEqual } from "node:crypto";
/** Narrow, short-lived authorization for reminder generation only. */
export function validNotificationSignature(
  timestamp: string | null,
  signature: string | null,
  secret: string | undefined,
  now = Date.now(),
) {
  if (
    !secret ||
    !timestamp ||
    !signature ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const age = now / 1000 - Number(timestamp);
  if (age < -60 || age > 300) return false;
  const expected = createHmac("sha256", secret)
    .update("lifeos-notifications:" + timestamp)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
