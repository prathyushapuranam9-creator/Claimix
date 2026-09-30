import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
/** A db handle or an open transaction: repositories accept either. */
export type DbOrTx = Pick<Db, "select" | "selectDistinct" | "insert" | "update" | "delete" | "execute" | "transaction">;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

const globalForDb = globalThis as unknown as { __claimixDb?: Db };

/** Process-wide database handle (survives Next.js dev hot reloads). */
export function getDb(): Db {
  if (!globalForDb.__claimixDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__claimixDb = createDb(url).db;
  }
  return globalForDb.__claimixDb;
}
