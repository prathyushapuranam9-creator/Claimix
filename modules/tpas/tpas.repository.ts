import "server-only";
import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { organizations, policies, tpas } from "@/db/schema";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import { andAll } from "@/lib/permissions/scope";

/** Reference data (insurer:read covers insurers and TPAs). */
export const TpaRepository = {
  /**
   * `countFor` limits "policies serviced" to the products the viewer may see: an insurer counts only its
   * own policies run by each TPA, a TPA only its own; administrators and hospitals count all.
   */
  async list(db: DbOrTx, q: ListQuery, countFor: { insurerId?: string; tpaId?: string } = {}) {
    const where = andAll(
      isNull(tpas.deletedAt),
      q.q ? or(ilike(organizations.name, likeContains(q.q)), ilike(tpas.code, likeContains(q.q))) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: tpas.id,
          name: organizations.name,
          code: tpas.code,
          phone: tpas.phone,
          isActive: organizations.isActive,
          isDemo: organizations.isDemo,
          policyCount: sql<number>`(select count(*)::int from ${policies} p where p.tpa_id = ${tpas.id} and p.deleted_at is null
            ${countFor.insurerId ? sql`and p.insurer_id = ${countFor.insurerId}` : sql``}
            ${countFor.tpaId ? sql`and p.tpa_id = ${countFor.tpaId}` : sql``})`,
        })
        .from(tpas)
        .innerJoin(organizations, eq(organizations.id, tpas.id))
        .where(where)
        .orderBy(asc(organizations.name))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(tpas).innerJoin(organizations, eq(organizations.id, tpas.id)).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db
      .select({ tpa: tpas, name: organizations.name, isActive: organizations.isActive, isDemo: organizations.isDemo })
      .from(tpas)
      .innerJoin(organizations, eq(organizations.id, tpas.id))
      .where(and(eq(tpas.id, id), isNull(tpas.deletedAt)))
      .limit(1);
    return row;
  },

  async exists(db: DbOrTx, id: string) {
    const [row] = await db.select({ id: tpas.id }).from(tpas).where(and(eq(tpas.id, id), isNull(tpas.deletedAt))).limit(1);
    return !!row;
  },

  async codeTaken(db: DbOrTx, code: string, exceptId?: string) {
    const [row] = await db
      .select({ id: tpas.id })
      .from(tpas)
      .where(and(eq(tpas.code, code), exceptId ? sql`${tpas.id} <> ${exceptId}` : undefined))
      .limit(1);
    return !!row;
  },

  async insert(db: DbOrTx, values: typeof tpas.$inferInsert) {
    const [row] = await db.insert(tpas).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof tpas.$inferInsert>) {
    const [row] = await db.update(tpas).set(values).where(eq(tpas.id, id)).returning();
    return row!;
  },

  async options(db: DbOrTx) {
    return db
      .select({ id: tpas.id, name: organizations.name })
      .from(tpas)
      .innerJoin(organizations, eq(organizations.id, tpas.id))
      .where(and(isNull(tpas.deletedAt), eq(organizations.isActive, true)))
      .orderBy(asc(organizations.name));
  },
};
