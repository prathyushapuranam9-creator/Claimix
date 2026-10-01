import { config } from "dotenv";
import { createDb, type Db, type DbOrTx } from "@/db/client";
import { seedRbac } from "./rbac";
import { seedReasons } from "./reasons";

/**
 * System configuration every installation needs — not sample data:
 * - the permission catalog and default role grants (authorization can't work without them);
 * - the general query/rejection-reason guidance (not insurer-specific).
 * Idempotent and non-destructive: adds or updates these rows only, never business data.
 * Organizations, users, patients, policies, schemes and codes are created by real users.
 */
export async function setupSystem(db: DbOrTx) {
  const roleIds = await seedRbac(db);
  await seedReasons(db);
  return roleIds;
}

async function main(db: Db) {
  await db.transaction((tx) => setupSystem(tx));
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("db/setup/index.ts")) {
  config({ path: ".env.local" });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }
  const { db, close } = createDb(url, { max: 1 });
  main(db)
    .then(() => console.error("System configuration is up to date (roles, permissions, reason guidance)."))
    .catch((e) => {
      console.error("Setup failed:", e instanceof Error ? e.stack : e);
      process.exitCode = 1;
    })
    .finally(close);
}
