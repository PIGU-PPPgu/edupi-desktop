export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { captureEduPiCoreRendezvous } = await import("@/lib/edupi-core-rendezvous");
  captureEduPiCoreRendezvous();

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
