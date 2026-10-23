export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  const { readDesktopSystemProxy } = await import("@/lib/desktop-system-proxy");
  configureHttpDispatcher(undefined, await readDesktopSystemProxy());
}
