import { config } from "dotenv";
import path from "node:path";
import { and, eq, gt, inArray } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { jobs } from "@/db/schema";
import { logger } from "@/lib/logging/logger";
import { todayIso } from "@/lib/validation";
import { basicScanner } from "@/modules/documents/scanner";
import { documentScanJob } from "@/modules/documents/scan-job";
import { JobQueue } from "@/modules/jobs/job-queue";
import { emailJobHandler, outboxSender } from "@/modules/notifications/email";
import { sendPolicyExpiryReminders } from "@/modules/notifications/reminders";

config({ path: ".env.local" });

const HOUR = 3_600_000;

/** Enqueues the daily policy-expiry reminder run unless one ran (or is queued) in the last 20 hours. */
async function scheduleDaily(db: Db) {
  const [recent] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, "reminder.policy_expiry"), inArray(jobs.status, ["queued", "running", "succeeded"]), gt(jobs.createdAt, new Date(Date.now() - 20 * HOUR))))
    .limit(1);
  if (!recent) await JobQueue.enqueue(db, "reminder.policy_expiry", {});
}

/**
 * Background worker: polls the job table. Run alongside the web app with
 * `npm run worker`. Business code only enqueues jobs, so a real queue can
 * replace this loop later without changing callers.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, close } = createDb(url, { max: 2 });
  const storage = process.env.STORAGE_LOCAL_DIR ?? "./.storage";
  const handlers = {
    "email.send": emailJobHandler(db, outboxSender(path.join(storage, "outbox"))),
    "document.scan": documentScanJob(db, basicScanner),
    "reminder.policy_expiry": async () => {
      const n = await sendPolicyExpiryReminders(db, todayIso());
      logger.info("policy_expiry_reminders_sent", { count: n });
    },
  };

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  logger.info("worker_started");

  let lastSchedule = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastSchedule > HOUR) {
        await scheduleDaily(db);
        lastSchedule = Date.now();
      }
      const n = await JobQueue.runDue(db, handlers, 20);
      if (n === 0) await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      logger.error("worker_loop_error", { error: e });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await close();
  logger.info("worker_stopped");
}

main().catch((e) => {
  logger.error("worker_crashed", { error: e });
  process.exit(1);
});
