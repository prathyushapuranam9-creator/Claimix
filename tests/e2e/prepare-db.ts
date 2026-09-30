import { config } from "dotenv";
import postgres from "postgres";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/db/seed";

config({ path: ".env.local" });

/**
 * Browser tests run against their own database so they never change the dev
 * demo data. It is created if missing, migrated, seeded, and demo balances are
 * restored each run. Nothing is dropped.
 */
async function prepare() {
  const url = process.env.E2E_DATABASE_URL;
  const pw = process.env.SEED_DEMO_PASSWORD;
  if (!url || !pw) throw new Error("E2E_DATABASE_URL and SEED_DEMO_PASSWORD must be set in .env.local");

  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  // Safety: only ever prepare a database explicitly named for end-to-end tests.
  if (!/^[a-z0-9_]+_e2e$/.test(dbName)) throw new Error("E2E_DATABASE_URL must point to a database whose name ends in _e2e");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sqlc = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await sqlc`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await sqlc.unsafe(`create database ${dbName}`);
  } finally {
    await sqlc.end({ timeout: 5 });
  }

  await runMigrations(url);
  const { db, close } = createDb(url, { max: 1 });
  try {
    await seed(db, pw, { resetDemoPasswords: true, resetDemoBalances: true });
  } finally {
    await close();
  }
}

prepare()
  .then(() => console.error("E2E database ready."))
  .catch((e) => {
    console.error("E2E database setup failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
