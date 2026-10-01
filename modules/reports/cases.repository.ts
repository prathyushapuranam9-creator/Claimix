import "server-only";
import { asc, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { lookup } from "@/db/lookup";
import { claims, governmentSchemes, organizations, patients, payerResponses, settlements } from "@/db/schema";
import type { Scope } from "@/lib/permissions/catalog";
import type { Principal } from "@/lib/permissions/principal";
import { andAll, scopePredicate } from "@/lib/permissions/scope";
import { CLAIM_SCOPE } from "@/modules/claims/claims.repository";
import type { DateRange } from "./reports.repository";

/*
 * Per-case figures, all computed in the database from recorded data:
 * - billed    = the claimed amount on the claim;
 * - approved  = the payer's approved amount (0 until one is recorded);
 * - received  = the settlement recorded as paid (0 until paid);
 * - shortfall = billed − received, never below 0 (what is still outstanding);
 * - TAT       = whole days from submission to the payer's first final decision
 *               (approved / partially approved / rejected) — the same definition as
 *               the turnaround report — or, while still awaiting a decision, days so far.
 *               Drafts have no TAT.
 */
const firstDecision = sql`(select min(pr.created_at) from ${payerResponses} pr
  where pr.subject_type = 'claim' and pr.subject_id = ${claims.id} and pr.decision in ('approved', 'partially_approved', 'rejected'))`;

const billed = sql<string | null>`${claims.claimedAmount}`;
const approved = sql<string>`coalesce(${claims.approvedAmount}, 0)`;
const received = sql<string>`coalesce((select ${settlements.amount} from ${settlements} where ${settlements.claimId} = ${claims.id} and ${settlements.status} = 'paid'), 0)`;
const shortfall = sql<string>`greatest(coalesce(${claims.claimedAmount}, 0) - ${received}, 0)`;
const tatDays = sql<number | null>`case when ${claims.submittedAt} is null then null
  else floor(extract(epoch from (coalesce(${firstDecision}, now()) - ${claims.submittedAt})) / 86400)::int end`;
const tatOpen = sql<boolean>`(${claims.submittedAt} is not null and ${firstDecision} is null)`;
const payerName = sql<string | null>`coalesce(${lookup(organizations, "name", claims.insurerId)}, ${lookup(governmentSchemes, "name", claims.schemeId)})`;

/** Sortable columns → the underlying SQL value (never a formatted string). */
export const CASE_SORTS = {
  case: sql`${claims.reference}`,
  patient: sql`${patients.fullName}`,
  insurer: payerName,
  billed: sql`coalesce(${claims.claimedAmount}, 0)`,
  approved,
  received,
  shortfall,
  tat: tatDays,
  status: sql`${claims.status}::text`,
} as const;

export type CaseSort = keyof typeof CASE_SORTS;
export type SortDir = "asc" | "desc";

export const TAT_BUCKETS = [
  { key: "0-15", label: "0–15 days", min: 0, max: 15 },
  { key: "16-30", label: "16–30 days", min: 16, max: 30 },
  { key: "31-45", label: "31–45 days", min: 31, max: 45 },
  { key: "46-60", label: "46–60 days", min: 46, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "90+ days", min: 91, max: null },
] as const;

export type TatBucketKey = (typeof TAT_BUCKETS)[number]["key"];

const bucketOf = sql<string>`case
  when ${tatDays} <= 15 then '0-15'
  when ${tatDays} <= 30 then '16-30'
  when ${tatDays} <= 45 then '31-45'
  when ${tatDays} <= 60 then '46-60'
  when ${tatDays} <= 90 then '61-90'
  else '90+' end`;

function where(principal: Principal, scope: Scope, r: DateRange): SQL | undefined {
  const at = sql`coalesce(${claims.submittedAt}, ${claims.createdAt})`;
  return andAll(
    scopePredicate(principal, scope, CLAIM_SCOPE),
    sql`${claims.status} <> 'cancelled'`,
    r.from ? gte(at, sql`${r.from}::date`) : undefined,
    r.to ? lt(at, sql`(${r.to}::date + 1)`) : undefined,
  );
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export const CaseReportRepository = {
  /** One page of cases, sorted on real values, plus the total count. */
  async cases(db: DbOrTx, principal: Principal, scope: Scope, r: DateRange, o: { sort: CaseSort; dir: SortDir; page: number; pageSize: number }) {
    const w = where(principal, scope, r);
    const order = o.dir === "asc" ? asc(CASE_SORTS[o.sort]) : desc(CASE_SORTS[o.sort]);
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: claims.id,
          reference: claims.reference,
          status: claims.status,
          patientName: patients.fullName,
          payerName,
          billed,
          approved,
          received,
          shortfall,
          tatDays,
          tatOpen,
        })
        .from(claims)
        .innerJoin(patients, eq(patients.id, claims.patientId))
        .where(w)
        .orderBy(sql`${order} nulls last`, asc(claims.id))
        .limit(o.pageSize)
        .offset((o.page - 1) * o.pageSize),
      db.select({ n: count() }).from(claims).innerJoin(patients, eq(patients.id, claims.patientId)).where(w),
    ]);
    return {
      total: total?.n ?? 0,
      rows: rows.map((x) => ({
        ...x,
        billed: num(x.billed),
        approved: Number(x.approved),
        received: Number(x.received),
        shortfall: Number(x.shortfall),
        tatDays: x.tatDays === null ? null : Number(x.tatDays),
      })),
    };
  },

  /** Submitted cases grouped into TAT buckets, aggregated in the database. Drafts (no TAT) are counted separately. */
  async tatDistribution(db: DbOrTx, principal: Principal, scope: Scope, r: DateRange) {
    const w = where(principal, scope, r);
    const [grouped, [notSubmitted]] = await Promise.all([
      db
        .select({
          bucket: bucketOf,
          cases: count(),
          billed: sql<string>`coalesce(sum(coalesce(${claims.claimedAmount}, 0)), 0)`,
          approved: sql<string>`coalesce(sum(${approved}), 0)`,
          received: sql<string>`coalesce(sum(${received}), 0)`,
        })
        .from(claims)
        .where(andAll(w, sql`${claims.submittedAt} is not null`))
        .groupBy(bucketOf),
      db.select({ n: count() }).from(claims).where(andAll(w, sql`${claims.submittedAt} is null`)),
    ]);
    const by = new Map(grouped.map((g) => [g.bucket, g]));
    const buckets = TAT_BUCKETS.map((b) => {
      const g = by.get(b.key);
      return { key: b.key, label: b.label, cases: g?.cases ?? 0, billed: Number(g?.billed ?? 0), approved: Number(g?.approved ?? 0), received: Number(g?.received ?? 0) };
    });
    const totalCases = buckets.reduce((a, b) => a + b.cases, 0);
    return { buckets, totalCases, notSubmitted: notSubmitted?.n ?? 0 };
  },
};
