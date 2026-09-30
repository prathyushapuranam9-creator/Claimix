import "server-only";
import { and, asc, count, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { governmentSchemes, hospitalNetworks, hospitals, insurers, organizations } from "@/db/schema";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";

/**
 * Anonymous hospital-network directory (Insurance → City → Hospital).
 * Returns reference fields only — name, location, network status, cashless flag,
 * last verification — never contacts, registration numbers or any case data.
 * Private insurer networks and scheme empanelment stay separate: a search is
 * always for exactly one insurer or one scheme.
 */
export type PublicPayer = { kind: "insurer" | "scheme"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses the `payer` URL value ("insurer:<uuid>" / "scheme:<uuid>"); anything else is ignored. */
export function parsePublicPayer(value: string | undefined): PublicPayer | undefined {
  const m = /^(insurer|scheme):(.+)$/.exec(value ?? "");
  if (!m || !UUID.test(m[2]!)) return undefined;
  return { kind: m[1] as PublicPayer["kind"], id: m[2]! };
}

function payerMatch(p: PublicPayer) {
  return and(
    p.kind === "insurer" ? eq(hospitalNetworks.insurerId, p.id) : eq(hospitalNetworks.schemeId, p.id),
    inArray(hospitalNetworks.status, p.kind === "insurer" ? ["network"] : ["empanelled"]),
  );
}

const activeHospital = and(isNull(hospitals.deletedAt), eq(organizations.isActive, true), isNull(organizations.deletedAt));

export const PublicNetworkService = {
  async payers(db: DbOrTx) {
    const [ins, schemes] = await Promise.all([
      db
        .select({ id: insurers.id, name: organizations.name })
        .from(insurers)
        .innerJoin(organizations, eq(organizations.id, insurers.id))
        .where(and(isNull(insurers.deletedAt), eq(organizations.isActive, true), isNull(organizations.deletedAt)))
        .orderBy(asc(organizations.name)),
      db
        .select({ id: governmentSchemes.id, name: governmentSchemes.name })
        .from(governmentSchemes)
        .where(isNull(governmentSchemes.deletedAt))
        .orderBy(asc(governmentSchemes.name)),
    ]);
    return { insurers: ins, schemes };
  },

  /** Cities with at least one listed hospital for this payer. */
  async cities(db: DbOrTx, payer: PublicPayer) {
    const rows = await db
      .selectDistinct({ city: hospitals.city, state: hospitals.state })
      .from(hospitalNetworks)
      .innerJoin(hospitals, eq(hospitals.id, hospitalNetworks.hospitalId))
      .innerJoin(organizations, eq(organizations.id, hospitals.id))
      .where(and(payerMatch(payer), activeHospital))
      .orderBy(asc(hospitals.city));
    return rows;
  },

  async search(db: DbOrTx, payer: PublicPayer, q: ListQuery, city?: string) {
    const where = and(
      payerMatch(payer),
      activeHospital,
      city ? eq(hospitals.city, city) : undefined,
      q.q ? ilike(organizations.name, likeContains(q.q)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: hospitals.id,
          name: organizations.name,
          city: hospitals.city,
          state: hospitals.state,
          status: hospitalNetworks.status,
          cashlessAvailable: hospitalNetworks.cashlessAvailable,
          lastVerifiedAt: hospitalNetworks.lastVerifiedAt,
          isDemo: organizations.isDemo,
        })
        .from(hospitalNetworks)
        .innerJoin(hospitals, eq(hospitals.id, hospitalNetworks.hospitalId))
        .innerJoin(organizations, eq(organizations.id, hospitals.id))
        .where(where)
        .orderBy(asc(hospitals.city), asc(organizations.name), asc(sql`${hospitals.id}`))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db
        .select({ n: count() })
        .from(hospitalNetworks)
        .innerJoin(hospitals, eq(hospitals.id, hospitalNetworks.hospitalId))
        .innerJoin(organizations, eq(organizations.id, hospitals.id))
        .where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },
};
