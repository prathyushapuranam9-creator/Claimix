import { config } from "dotenv";
import { createDb, type Db } from "@/db/client";
import { seedRbac } from "./rbac";
import { seedCore } from "./core";
import { seedNetwork } from "./network";
import { seedPolicies } from "./policies";
import { seedReasons } from "./reasons";

/** Idempotent, non-destructive DEMO DATA seed. Safe to re-run; never deletes business data. */
export interface SeedOptions {
  /** Test databases only: re-hash demo users with the run's password. */
  resetDemoPasswords?: boolean;
  /** Test databases only: restore demo coverage balances used up by earlier runs. */
  resetDemoBalances?: boolean;
}

export async function seed(db: Db, demoPassword: string, opts: SeedOptions = {}) {
  await db.transaction(async (tx) => {
    const roleIds = await seedRbac(tx);
    await seedCore(tx, roleIds, demoPassword, opts);
    await seedNetwork(tx);
    await seedPolicies(tx, opts);
    await seedReasons(tx);
  });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("db/seed/index.ts")) {
  config({ path: ".env.local" });
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed DEMO DATA in production.");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  const pw = process.env.SEED_DEMO_PASSWORD;
  if (!url || !pw || pw.length < 12) {
    console.error("DATABASE_URL and SEED_DEMO_PASSWORD (min 12 chars) must be set in .env.local");
    process.exit(1);
  }
  const { db, close } = createDb(url, { max: 1 });
  seed(db, pw)
    .then(() => console.error("DEMO DATA seeded."))
    .catch((e) => {
      console.error("Seed failed:", e instanceof Error ? e.stack : e);
      process.exitCode = 1;
    })
    .finally(close);
}
