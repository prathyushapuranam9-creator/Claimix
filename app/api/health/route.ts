import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logging/logger";

export const dynamic = "force-dynamic";

/** Liveness + database readiness. Reveals no configuration or version details. */
export async function GET() {
  const started = performance.now();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok", ms: Math.round(performance.now() - started) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logger.error("health_db_failed", { error: e });
    return Response.json({ status: "degraded", db: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
