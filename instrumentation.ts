/**
 * Runs once when a server instance starts: validate configuration up front so a
 * misconfigured deployment fails at boot, not on the first request that needs it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { env } = await import("@/lib/config/env");
  env();
}
