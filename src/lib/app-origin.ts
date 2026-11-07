/** Trust the platform-provided deployment name, never a request Host header. */
export function applicationOrigin(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  if (env.VERCEL_ENV === "preview") {
    if (!env.VERCEL_URL || !/^[a-z0-9-]+\.vercel\.app$/i.test(env.VERCEL_URL))
      return undefined;
    return `https://${env.VERCEL_URL}`;
  }
  return env.LIFE_OS_APP_ORIGIN;
}
