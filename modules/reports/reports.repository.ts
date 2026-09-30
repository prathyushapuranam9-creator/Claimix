import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { claims, payerResponses, preAuthorizations, rejectionReasons, settlements } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate } from "@/lib/permissions/scope";
import { CLAIM_SCOPE } from "@/modules/claims/claims.repository";
import { PREAUTH_SCOPE } from "@/modules/preauth/preauth.repository";

/** Inclusive `from`, exclusive `to` (ISO dates), applied to when a case was submitted (or created, for drafts). */
export interface DateRange {
  from?: string;
  to?: string;
}

export type CaseKind = "preauth" | "claim";

const T = {
  preauth: { table: preAuthorizations, scope: PREAUTH_SCOPE },
  claim: { table: claims, scope: CLAIM_SCOPE },
} as const;

function rangeOn(col: SQL, r: DateRange): SQL | undefined {
  return andAll(r.from ? gte(col, sql`${r.from}::date`) : undefined, r.to ? lt(col, sql`(${r.to}::date + 1)`) : undefined);
}

function caseWhere(kind: CaseKind, principal: Principal, scope: Scope, r: DateRange) {
  const t = T[kind].table;
  return andAll(scopePredicate(principal, scope, T[kind].scope), rangeOn(sql`coalesce(${t.submittedAt}, ${t.createdAt})`, r));
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/**
 * Aggregate, tenant-scoped reporting queries. Every query starts from the same
 * scope predicate the list pages use, so a report can never count a row its
 * viewer couldn't open.
 */
export const ReportRepository = {
  async statusCounts(db: DbOrTx, kind: CaseKind, principal: Principal, scope: Scope, r: DateRange = {}) {
    const t = T[kind].table;
    const rows = await db.select({ status: t.status, n: count() }).from(t).where(caseWhere(kind, principal, scope, r)).groupBy(t.status);
    return Object.fromEntries(rows.map((x) => [x.status, x.n])) as Record<string, number>;
  },

  /** Claim money by claim type: claimed, approved, patient share, and settlements actually paid. */
  async claimFinancials(db: DbOrTx, principal: Principal, scope: Scope, r: DateRange = {}) {
    const rows = await db
      .select({
        claimType: claims.claimType,
        claims: count(),
        claimed: sql<string>`coalesce(sum(${claims.claimedAmount}) filter (where ${claims.status} not in ('draft', 'cancelled')), 0)`,
        approved: sql<string>`coalesce(sum(${claims.approvedAmount}) filter (where ${claims.status} in ('approved', 'partially_approved', 'settled')), 0)`,
        patient: sql<string>`coalesce(sum(${claims.patientAmount}) filter (where ${claims.status} in ('approved', 'partially_approved', 'settled')), 0)`,
        settled: sql<string>`coalesce(sum(${settlements.amount}) filter (where ${settlements.status} = 'paid'), 0)`,
      })
      .from(claims)
      .leftJoin(settlements, eq(settlements.claimId, claims.id))
      .where(caseWhere("claim", principal, scope, r))
      .groupBy(claims.claimType);
    return rows.map((x) => ({
      claimType: x.claimType,
      claims: x.claims,
      claimed: num(x.claimed),
      approved: num(x.approved),
      patient: num(x.patient),
      settled: num(x.settled),
    }));
  },

  /** Submitted claims per month: count, claimed and approved amounts. */
  async claimsByMonth(db: DbOrTx, principal: Principal, scope: Scope, r: DateRange) {
    const month = sql<string>`to_char(date_trunc('month', ${claims.submittedAt}), 'YYYY-MM')`;
    const rows = await db
      .select({
        month,
        n: count(),
        claimed: sql<string>`coalesce(sum(${claims.claimedAmount}), 0)`,
        approved: sql<string>`coalesce(sum(${claims.approvedAmount}) filter (where ${claims.status} in ('approved', 'partially_approved', 'settled')), 0)`,
      })
      .from(claims)
      .where(and(isNotNull(claims.submittedAt), caseWhere("claim", principal, scope, r)))
      .groupBy(month)
      .orderBy(month);
    return rows.map((x) => ({ month: x.month, n: x.n, claimed: num(x.claimed), approved: num(x.approved) }));
  },

  /**
   * Hours from submission to the payer's first final decision (approved,
   * partially approved or rejected). Queries in between count as elapsed time.
   */
  async turnaround(db: DbOrTx, kind: CaseKind, principal: Principal, scope: Scope, r: DateRange = {}) {
    const t = T[kind].table;
    const firstDecision = sql`(select min(pr.created_at) from ${payerResponses} pr
      where pr.subject_type = ${kind} and pr.subject_id = ${t.id} and pr.decision in ('approved', 'partially_approved', 'rejected'))`;
    const hours = sql`extract(epoch from (${firstDecision} - ${t.submittedAt})) / 3600.0`;
    const [row] = await db
      .select({
        decided: sql<number>`count(${firstDecision})::int`,
        avgHours: sql<string | null>`avg(${hours})`,
        medianHours: sql<string | null>`percentile_cont(0.5) within group (order by ${hours})`,
        awaiting: sql<number>`count(*) filter (where ${t.status} in ('submitted', 'pending'))::int`,
      })
      .from(t)
      .where(and(isNotNull(t.submittedAt), caseWhere(kind, principal, scope, r)));
    return {
      decided: row?.decided ?? 0,
      awaiting: row?.awaiting ?? 0,
      avgHours: row?.avgHours == null ? null : Number(row.avgHours),
      medianHours: row?.medianHours == null ? null : Number(row.medianHours),
    };
  },

  /** Most frequent query / rejection reasons recorded by payers on in-scope cases. */
  async topReasons(db: DbOrTx, principal: Principal, scopes: { preauth: Scope | null; claim: Scope | null }, r: DateRange = {}, limit = 8) {
    const one = async (kind: CaseKind, scope: Scope) => {
      const t = T[kind].table;
      return db
        .select({ code: rejectionReasons.code, title: rejectionReasons.title, decision: payerResponses.decision, n: count() })
        .from(payerResponses)
        .innerJoin(t, and(eq(payerResponses.subjectType, kind), eq(payerResponses.subjectId, t.id)))
        .innerJoin(rejectionReasons, eq(rejectionReasons.id, payerResponses.rejectionReasonId))
        .where(and(inArray(payerResponses.decision, ["query", "rejected"]), scopePredicate(principal, scope, T[kind].scope), rangeOn(sql`${payerResponses.createdAt}`, r)))
        .groupBy(rejectionReasons.code, rejectionReasons.title, payerResponses.decision);
    };
    const parts = await Promise.all([
      scopes.preauth ? one("preauth", scopes.preauth) : [],
      scopes.claim ? one("claim", scopes.claim) : [],
    ]);
    const merged = new Map<string, { code: string; title: string; queries: number; rejections: number }>();
    for (const row of parts.flat()) {
      const m = merged.get(row.code) ?? { code: row.code, title: row.title, queries: 0, rejections: 0 };
      if (row.decision === "query") m.queries += row.n;
      else m.rejections += row.n;
      merged.set(row.code, m);
    }
    return [...merged.values()].sort((a, b) => b.queries + b.rejections - (a.queries + a.rejections) || a.title.localeCompare(b.title)).slice(0, limit);
  },

  /** Most recently updated cases (reference and status only). */
  async recent(db: DbOrTx, kind: CaseKind, principal: Principal, scope: Scope, limit = 6, statuses?: string[]) {
    const t = T[kind].table;
    return db
      .select({ id: t.id, reference: t.reference, status: t.status, updatedAt: t.updatedAt })
      .from(t)
      .where(andAll(scopePredicate(principal, scope, T[kind].scope), statuses?.length ? sql`${t.status}::text in ${statuses}` : undefined))
      .orderBy(desc(t.updatedAt), desc(t.id))
      .limit(limit);
  },
};
