import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import type { TestProject } from "vitest/node";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/tests/fixtures/seed";

config({ path: ".env.local" });

declare module "vitest" {
  export interface ProvidedContext {
    testDbUrl: string;
    demoPassword: string;
  }
}

/**
 * Integration tests run against a dedicated test database (never the dev DB).
 * Migrations + idempotent seed are applied; nothing is dropped or truncated.
 */
export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");

  await runMigrations(url);
  // Fresh random password each run; the seed re-hashes demo users' passwords.
  const demoPassword = `T3st-${randomBytes(8).toString("hex")}`;
  const { db, close } = createDb(url, { max: 1 });
  try {
    await seed(db, demoPassword, { resetDemoPasswords: true, resetDemoBalances: true });
  } finally {
    await close();
  }
  project.provide("testDbUrl", url);
  project.provide("demoPassword", demoPassword);
}
