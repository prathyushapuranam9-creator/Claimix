import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

config({ path: ".env.local" });

/** Applies pending migrations only. Never drops or resets anything. */
export async function runMigrations(url: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
  } finally {
    await close();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runMigrations(url)
    .then(() => console.error("Migrations applied."))
    .catch((e) => {
      console.error("Migration failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
