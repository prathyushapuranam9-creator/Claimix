import "server-only";
import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { hospitalNetworks, insurers, organizations, policies} from "@/db/schema";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import { andAll } from "@/lib/permissions/scope";

/** Reference data (insurer:read). */
export const InsurerRepository = {
  /** `countFor` limits "policies" to products the viewer may see (an insurer: its own; a TPA: those it administers). */
  async list(db: DbOrTx, q: ListQuery, countFor: { insurerId?: string; tpaId?: string } = {}) {
    const where = andAll(
      isNull(insurers.deletedAt),
      q.q ? or(ilike(organizations.name, likeContains(q.q)), ilike(insurers.code, likeContains(q.q))) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: insurers.id,
          name: organizations.name,
          code: insurers.code,
          claimsPhone: insurers.claimsPhone,
          isActive: organizations.isActive,
          isDemo: organizations.isDemo,
          policyCount: sql<number>`(select count(*)::int from ${policies} p where p.insurer_id = ${insurers.id} and p.deleted_at is null
            ${countFor.insurerId ? sql`and p.insurer_id = ${countFor.insurerId}` : sql``}
            ${countFor.tpaId ? sql`and p.tpa_id = ${countFor.tpaId}` : sql``})`,
          networkCount: sql<number>`(select count(*)::int from ${hospitalNetworks} hn where hn.insurer_id = ${insurers.id} and hn.status = 'network')`,
        })
        .from(insurers)
        .innerJoin(organizations, eq(organizations.id, insurers.id))
        .where(where)
        .orderBy(asc(organizations.name))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(insurers).innerJoin(organizations, eq(organizations.id, insurers.id)).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  /** Hospitals in this insurer's network (status "network"); reference data, like the hospital list. */
  async networkHospitalCount(db: DbOrTx, id: string) {
    const [r] = await db.select({ n: count() }).from(hospitalNetworks).where(and(eq(hospitalNetworks.insurerId, id), eq(hospitalNetworks.status, "network")));
    return r?.n ?? 0;
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db
      .select({ insurer: insurers, name: organizations.name, isActive: organizations.isActive, isDemo: organizations.isDemo })
      .from(insurers)
      .innerJoin(organizations, eq(organizations.id, insurers.id))
      .where(and(eq(insurers.id, id), isNull(insurers.deletedAt)))
      .limit(1);
    return row;
  },

  async exists(db: DbOrTx, id: string) {
    const [row] = await db.select({ id: insurers.id }).from(insurers).where(and(eq(insurers.id, id), isNull(insurers.deletedAt))).limit(1);
    return !!row;
  },

  async codeTaken(db: DbOrTx, code: string, exceptId?: string) {
    const [row] = await db
      .select({ id: insurers.id })
      .from(insurers)
      .where(and(eq(insurers.code, code), exceptId ? sql`${insurers.id} <> ${exceptId}` : undefined))
      .limit(1);
    return !!row;
  },

  async insert(db: DbOrTx, values: typeof insurers.$inferInsert) {
    const [row] = await db.insert(insurers).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof insurers.$inferInsert>) {
    const [row] = await db.update(insurers).set(values).where(eq(insurers.id, id)).returning();
    return row!;
  },

  async options(db: DbOrTx) {
    return db
      .select({ id: insurers.id, name: organizations.name })
      .from(insurers)
      .innerJoin(organizations, eq(organizations.id, insurers.id))
      .where(and(isNull(insurers.deletedAt), eq(organizations.isActive, true)))
      .orderBy(asc(organizations.name));
  },
};
