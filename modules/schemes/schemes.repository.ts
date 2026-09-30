import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { governmentSchemes } from "@/db/schema";

/** Government health schemes. Kept separate from private insurers throughout. */
export const SchemeRepository = {
  async options(db: DbOrTx) {
    return db
      .select({ id: governmentSchemes.id, name: governmentSchemes.name })
      .from(governmentSchemes)
      .where(isNull(governmentSchemes.deletedAt))
      .orderBy(asc(governmentSchemes.name));
  },

  async exists(db: DbOrTx, id: string) {
    const [row] = await db
      .select({ id: governmentSchemes.id })
      .from(governmentSchemes)
      .where(and(eq(governmentSchemes.id, id), isNull(governmentSchemes.deletedAt)))
      .limit(1);
    return !!row;
  },
};

export const SchemeQueries = {
  async list(db: DbOrTx) {
    return db.select().from(governmentSchemes).where(isNull(governmentSchemes.deletedAt)).orderBy(asc(governmentSchemes.name));
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db.select().from(governmentSchemes).where(and(eq(governmentSchemes.id, id), isNull(governmentSchemes.deletedAt))).limit(1);
    return row;
  },
};
