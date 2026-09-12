type ModelLike = { provider: string; baseUrl?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function isLoopbackModelUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Pi's AgentSession requires an auth-shaped value even for a local server.
 * Keep the marker in RuntimeCredentials only; never write it to auth.json and
 * never apply it to a non-loopback endpoint.
 */
export async function ensureLoopbackModelAuth(
  model: ModelLike,
  getAuth: () => Promise<unknown>,
  setRuntimeApiKey: (provider: string, key: string) => Promise<void>,
): Promise<boolean> {
  const resolved = record(await getAuth());
  const auth = record(resolved?.auth);
  if (auth?.apiKey || auth?.headers) return false;
  if (!isLoopbackModelUrl(model.baseUrl)) return false;
  await setRuntimeApiKey(model.provider, "local-loopback");
  return true;
}
