import "server-only";
import { aliasedTable, and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { governmentSchemes, hospitalNetworks, hospitals, organizations } from "@/db/schema";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import { andAll } from "@/lib/permissions/scope";

export interface HospitalFilters {
  state?: string;
  city?: string;
  insurerId?: string;
  schemeId?: string;
  cashlessOnly?: boolean;
}

const payerOrg = aliasedTable(organizations, "payer_org");

/** Reference data: hospitals are visible to anyone with hospital:read (no tenant scoping). */
export const HospitalRepository = {
  async list(db: DbOrTx, q: ListQuery, f: HospitalFilters = {}) {
    const networkMatch =
      f.insurerId || f.schemeId || f.cashlessOnly
        ? sql`exists (select 1 from ${hospitalNetworks} hn where hn.hospital_id = ${hospitals.id}
            and hn.status in ('network','empanelled')
            ${f.insurerId ? sql`and hn.insurer_id = ${f.insurerId}` : sql``}
            ${f.schemeId ? sql`and hn.scheme_id = ${f.schemeId}` : sql``}
            ${f.cashlessOnly ? sql`and hn.cashless_available` : sql``})`
        : undefined;
    const where = andAll(
      isNull(hospitals.deletedAt),
      eq(organizations.isActive, true),
      q.q ? or(ilike(organizations.name, likeContains(q.q)), ilike(hospitals.city, likeContains(q.q))) : undefined,
      f.state ? eq(hospitals.state, f.state) : undefined,
      f.city ? ilike(hospitals.city, f.city) : undefined,
      networkMatch,
    );
    const base = db.select({ n: count() }).from(hospitals).innerJoin(organizations, eq(organizations.id, hospitals.id)).where(where);
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: hospitals.id,
          name: organizations.name,
          city: hospitals.city,
          state: hospitals.state,
          departments: hospitals.departments,
          isDemo: organizations.isDemo,
          // Single aggregate subqueries instead of per-row lookups (no N+1).
          networkCount: sql<number>`(select count(*)::int from ${hospitalNetworks} hn where hn.hospital_id = ${hospitals.id} and hn.status = 'network')`,
          schemeCount: sql<number>`(select count(*)::int from ${hospitalNetworks} hn where hn.hospital_id = ${hospitals.id} and hn.status = 'empanelled')`,
          lastVerifiedAt: sql<Date | null>`(select max(hn.last_verified_at) from ${hospitalNetworks} hn where hn.hospital_id = ${hospitals.id})`,
        })
        .from(hospitals)
        .innerJoin(organizations, eq(organizations.id, hospitals.id))
        .where(where)
        .orderBy(asc(organizations.name))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      base,
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db
      .select({ hospital: hospitals, name: organizations.name, isActive: organizations.isActive, isDemo: organizations.isDemo })
      .from(hospitals)
      .innerJoin(organizations, eq(organizations.id, hospitals.id))
      .where(and(eq(hospitals.id, id), isNull(hospitals.deletedAt)))
      .limit(1);
    return row;
  },

  async networks(db: DbOrTx, hospitalId: string) {
    return db
      .select({
        id: hospitalNetworks.id,
        status: hospitalNetworks.status,
        cashlessAvailable: hospitalNetworks.cashlessAvailable,
        lastVerifiedAt: hospitalNetworks.lastVerifiedAt,
        insurerId: hospitalNetworks.insurerId,
        tpaId: hospitalNetworks.tpaId,
        schemeId: hospitalNetworks.schemeId,
        payerName: sql<string>`coalesce(${payerOrg.name}, ${governmentSchemes.name})`,
      })
      .from(hospitalNetworks)
      .leftJoin(payerOrg, or(eq(payerOrg.id, hospitalNetworks.insurerId), eq(payerOrg.id, hospitalNetworks.tpaId)))
      .leftJoin(governmentSchemes, eq(governmentSchemes.id, hospitalNetworks.schemeId))
      .where(eq(hospitalNetworks.hospitalId, hospitalId))
      .orderBy(asc(sql`coalesce(${payerOrg.name}, ${governmentSchemes.name})`));
  },

  async exists(db: DbOrTx, id: string) {
    const [row] = await db.select({ id: hospitals.id }).from(hospitals).where(and(eq(hospitals.id, id), isNull(hospitals.deletedAt))).limit(1);
    return !!row;
  },

  async insert(db: DbOrTx, values: typeof hospitals.$inferInsert) {
    const [row] = await db.insert(hospitals).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof hospitals.$inferInsert>) {
    const [row] = await db.update(hospitals).set(values).where(eq(hospitals.id, id)).returning();
    return row!;
  },

  async findNetwork(db: DbOrTx, hospitalId: string, payer: { insurerId?: string; tpaId?: string; schemeId?: string }) {
    const [row] = await db
      .select()
      .from(hospitalNetworks)
      .where(and(
        eq(hospitalNetworks.hospitalId, hospitalId),
        payer.insurerId ? eq(hospitalNetworks.insurerId, payer.insurerId) : undefined,
        payer.tpaId ? eq(hospitalNetworks.tpaId, payer.tpaId) : undefined,
        payer.schemeId ? eq(hospitalNetworks.schemeId, payer.schemeId) : undefined,
      ))
      .limit(1);
    return row;
  },

  async upsertNetwork(db: DbOrTx, values: typeof hospitalNetworks.$inferInsert, existingId?: string) {
    if (existingId) {
      const [row] = await db.update(hospitalNetworks).set(values).where(eq(hospitalNetworks.id, existingId)).returning();
      return row!;
    }
    const [row] = await db.insert(hospitalNetworks).values(values).returning();
    return row!;
  },

  async distinctStates(db: DbOrTx) {
    const rows = await db.selectDistinct({ state: hospitals.state }).from(hospitals).where(isNull(hospitals.deletedAt)).orderBy(asc(hospitals.state));
    return rows.map((r) => r.state);
  },
};

/**
 * Network status of a hospital for one payer. Private policies use the insurer's
 * row (falling back to the TPA's); scheme covers use the scheme's empanelment row.
 * Returns null when nothing is recorded — callers must treat that as unverified.
 */
export async function networkForPolicy(
  db: DbOrTx,
  hospitalId: string,
  policy: { category: "private" | "government"; insurerId: string | null; tpaId: string | null; schemeId: string | null },
) {
  const pick = async (col: "insurerId" | "tpaId" | "schemeId", id: string | null) =>
    id ? HospitalRepository.findNetwork(db, hospitalId, { [col]: id }) : undefined;
  const row = policy.category === "government"
    ? await pick("schemeId", policy.schemeId)
    : (await pick("insurerId", policy.insurerId)) ?? (await pick("tpaId", policy.tpaId));
  return row ?? null;
}
