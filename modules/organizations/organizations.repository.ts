import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { organizations } from "@/db/schema";
import type { OrgType } from "@/lib/permissions/catalog";

export const OrganizationRepository = {
  async insert(db: DbOrTx, type: OrgType, name: string) {
    const [row] = await db.insert(organizations).values({ type, name }).returning();
    return row!;
  },

  async rename(db: DbOrTx, id: string, name: string) {
    await db.update(organizations).set({ name }).where(eq(organizations.id, id));
  },

  async setActive(db: DbOrTx, id: string, isActive: boolean) {
    const [row] = await db.update(organizations).set({ isActive }).where(eq(organizations.id, id)).returning();
    return row;
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db.select().from(organizations).where(and(eq(organizations.id, id), isNull(organizations.deletedAt))).limit(1);
    return row;
  },

  /** Options for pickers (id + name), optionally restricted to types. */
  async options(db: DbOrTx, types?: OrgType[]) {
    return db
      .select({ id: organizations.id, name: organizations.name, type: organizations.type })
      .from(organizations)
      .where(and(isNull(organizations.deletedAt), types ? inArray(organizations.type, types) : undefined))
      .orderBy(asc(organizations.name));
  },
};
