/** Trust platform-provided deployment domains, never an arbitrary request Host header. */
const VERCEL_HOSTNAME = /^[a-z0-9-]+\.vercel\.app$/i;

export function applicationOrigin(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  if (env.VERCEL_ENV === "preview") {
    if (!env.VERCEL_URL || !VERCEL_HOSTNAME.test(env.VERCEL_URL))
      return undefined;
    return `https://${env.VERCEL_URL}`;
  }
  return env.LIFE_OS_APP_ORIGIN;
}

/**
 * Vercel exposes distinct immutable deployment and stable branch URLs.
 * Browsers may use either. Only trust exact origins furnished by Vercel,
 * never a broad *.vercel.app wildcard or client-controlled Host header.
 */
export function permittedApplicationOrigins(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string[] {
  const primary = applicationOrigin(env);
  if (env.VERCEL_ENV !== "preview") return primary ? [primary] : [];
  const branch =
    env.VERCEL_BRANCH_URL && VERCEL_HOSTNAME.test(env.VERCEL_BRANCH_URL)
      ? `https://${env.VERCEL_BRANCH_URL}`
      : undefined;
  return [...new Set([primary, branch].filter((v): v is string => !!v))];
}
