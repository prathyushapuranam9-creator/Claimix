import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { jobs } from "@/db/schema";
import { logger } from "@/lib/logging/logger";

/**
 * Background work abstraction. Business code only calls `enqueue` (inside its own
 * transaction, so jobs are never lost or sent for rolled-back changes). The
 * Postgres-backed implementation below can be swapped for a real broker later
 * without touching callers.
 */
export type JobType = "email.send" | "document.scan" | "report.export" | "reminder.policy_expiry";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export const JobQueue = {
  async enqueue(db: DbOrTx, type: JobType, payload: Record<string, unknown>, runAt = new Date()) {
    const [row] = await db.insert(jobs).values({ type, payload, runAt }).returning({ id: jobs.id });
    return row!.id;
  },

  /**
   * Claims and runs up to `limit` due jobs. Uses SKIP LOCKED so several workers can
   * run concurrently. Payloads are cleared on success (they may contain one-time links).
   */
  async runDue(db: Db, handlers: Partial<Record<JobType, JobHandler>>, limit = 10): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const done = await db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, new Date())))
          .orderBy(asc(jobs.runAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!job) return false;
        const handler = handlers[job.type as JobType];
        try {
          if (!handler) throw new Error(`No handler for job type ${job.type}`);
          await handler(job.payload);
          await tx.update(jobs).set({ status: "succeeded", payload: {}, attempts: job.attempts + 1 }).where(eq(jobs.id, job.id));
        } catch (e) {
          const attempts = job.attempts + 1;
          const retry = attempts < 5;
          logger.warn("job_failed", { jobId: job.id, type: job.type, attempts, error: e });
          await tx
            .update(jobs)
            .set({
              status: retry ? "queued" : "failed",
              // A job that will never run again must not keep one-time links or other payload data.
              ...(retry ? {} : { payload: {} }),
              attempts,
              lastError: e instanceof Error ? e.message.slice(0, 500) : "error",
              runAt: retry ? sql`now() + (${2 ** attempts} * interval '30 seconds')` : job.runAt,
            })
            .where(eq(jobs.id, job.id));
        }
        return true;
      });
      if (!done) break;
      processed++;
    }
    return processed;
  },
};
