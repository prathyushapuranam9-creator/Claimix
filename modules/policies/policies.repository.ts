import "server-only";
import { aliasedTable, and, asc, count, eq, ilike, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { beneficiaries, governmentSchemes, organizations, packages, policies, procedures, ruleSets, ruleVersions } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate, type ScopeColumns } from "@/lib/permissions/scope";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";

/**
 * Policy visibility: product information is reference data for hospitals and
 * read-only users ("all"); insurer/TPA reviewers see their own products; patients
 * see only the policies they are covered by.
 */
export const POLICY_SCOPE: ScopeColumns = {
  insurerId: policies.insurerId,
  tpaId: policies.tpaId,
  patientId: (pid) => sql`exists (select 1 from ${beneficiaries} b where b.policy_id = ${policies.id} and b.patient_id = ${pid} and b.deleted_at is null)`,
  policyId: policies.id,
};

/**
 * "all" on policy:read is reference-data access for hospital staff, administrators and read-only users, so it
 * needs no tenant filter for them. Payer organizations (insurers and TPAs) never get it: whatever their role grant
 * says, they only see their own products. This is enforced here, in the one place policy queries are scoped, so a
 * misconfigured or merged role matrix can't widen a payer's view.
 */
function policyScope(principal: Principal, scope: Scope) {
  const effective: Scope = scope === "all" && (principal.orgType === "insurer" || principal.orgType === "tpa") ? "organization" : scope;
  return effective === "all" ? undefined : scopePredicate(principal, effective, POLICY_SCOPE);
}

const insurerOrg = aliasedTable(organizations, "insurer_org");
const tpaOrg = aliasedTable(organizations, "tpa_org");

const activeVersionNo = sql<number | null>`(
  select rv.version from ${ruleVersions} rv join ${ruleSets} rs on rs.id = rv.rule_set_id
  where rs.policy_id = ${policies.id} and rv.status = 'active' limit 1)`;

export interface PolicyFilters {
  category?: "private" | "government";
  insurerId?: string;
  /** Policies a TPA administers. */
  tpaId?: string;
  /** Only policies currently offered (not withdrawn). */
  activeOnly?: boolean;
  schemeId?: string;
  productType?: string;
}

export const PolicyRepository = {
  async list(db: DbOrTx, principal: Principal, scope: Scope, q: ListQuery, f: PolicyFilters) {
    const where = andAll(
      isNull(policies.deletedAt),
      policyScope(principal, scope),
      f.category ? eq(policies.category, f.category) : undefined,
      f.insurerId ? eq(policies.insurerId, f.insurerId) : undefined,
      f.tpaId ? eq(policies.tpaId, f.tpaId) : undefined,
      f.activeOnly ? eq(policies.isActive, true) : undefined,
      f.schemeId ? eq(policies.schemeId, f.schemeId) : undefined,
      f.productType ? eq(policies.productType, f.productType) : undefined,
      q.q ? ilike(policies.name, likeContains(q.q)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: policies.id,
          name: policies.name,
          category: policies.category,
          productType: policies.productType,
          sumInsuredMin: policies.sumInsuredMin,
          sumInsuredMax: policies.sumInsuredMax,
          isActive: policies.isActive,
          isDemo: policies.isDemo,
          insurerName: insurerOrg.name,
          tpaName: tpaOrg.name,
          schemeName: governmentSchemes.name,
          activeVersion: activeVersionNo,
        })
        .from(policies)
        .leftJoin(insurerOrg, eq(insurerOrg.id, policies.insurerId))
        .leftJoin(tpaOrg, eq(tpaOrg.id, policies.tpaId))
        .leftJoin(governmentSchemes, eq(governmentSchemes.id, policies.schemeId))
        .where(where)
        .orderBy(asc(policies.name))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(policies).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  async findScoped(db: DbOrTx, principal: Principal, scope: Scope, id: string) {
    const [row] = await db
      .select({
        policy: policies,
        insurerName: insurerOrg.name,
        tpaName: tpaOrg.name,
        schemeName: governmentSchemes.name,
        schemeAuthority: governmentSchemes.authority,
      })
      .from(policies)
      .leftJoin(insurerOrg, eq(insurerOrg.id, policies.insurerId))
      .leftJoin(tpaOrg, eq(tpaOrg.id, policies.tpaId))
      .leftJoin(governmentSchemes, eq(governmentSchemes.id, policies.schemeId))
      .where(and(eq(policies.id, id), isNull(policies.deletedAt), policyScope(principal, scope)))
      .limit(1);
    return row;
  },

  async get(db: DbOrTx, id: string) {
    const [row] = await db.select().from(policies).where(and(eq(policies.id, id), isNull(policies.deletedAt))).limit(1);
    return row;
  },

  async exists(db: DbOrTx, id: string) {
    return !!(await PolicyRepository.get(db, id));
  },

  async insert(db: DbOrTx, values: typeof policies.$inferInsert) {
    const [row] = await db.insert(policies).values(values).returning();
    return row!;
  },

  async update(db: DbOrTx, id: string, values: Partial<typeof policies.$inferInsert>) {
    const [row] = await db.update(policies).set(values).where(eq(policies.id, id)).returning();
    return row!;
  },

  async packages(db: DbOrTx, policyId: string) {
    return db
      .select({ id: packages.id, code: packages.code, name: packages.name, rate: packages.rate, procedureCode: procedures.code })
      .from(packages)
      .leftJoin(procedures, eq(procedures.id, packages.procedureId))
      .where(eq(packages.policyId, policyId))
      .orderBy(asc(packages.name));
  },

  /** Options for coverage enrolment pickers (active, non-deleted). */
  async options(db: DbOrTx, category?: "private" | "government", viewer?: { principal: Principal; scope: Scope }) {
    return db
      .select({ id: policies.id, name: policies.name, category: policies.category, insurerName: insurerOrg.name, schemeName: governmentSchemes.name })
      .from(policies)
      .leftJoin(insurerOrg, eq(insurerOrg.id, policies.insurerId))
      .leftJoin(governmentSchemes, eq(governmentSchemes.id, policies.schemeId))
      .where(and(isNull(policies.deletedAt), eq(policies.isActive, true), category ? eq(policies.category, category) : undefined, viewer ? policyScope(viewer.principal, viewer.scope) : undefined))
      .orderBy(asc(policies.name));
  },
};
