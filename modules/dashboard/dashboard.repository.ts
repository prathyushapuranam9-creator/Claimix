import "server-only";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accessRequests, governmentSchemes, jobs, organizations, patients, policies, reviewRequests, users } from "@/db/schema";

export const DashboardRepository = {
  /** Reference data only — safe for read-only users; no case or patient data. */
  async referenceCounts(db: DbOrTx) {
    const [orgs, [schemes], [pols]] = await Promise.all([
      db
        .select({ type: organizations.type, n: count() })
        .from(organizations)
        .where(and(isNull(organizations.deletedAt), eq(organizations.isActive, true)))
        .groupBy(organizations.type),
      db.select({ n: count() }).from(governmentSchemes).where(isNull(governmentSchemes.deletedAt)),
      db.select({ n: count() }).from(policies).where(isNull(policies.deletedAt)),
    ]);
    const byType = Object.fromEntries(orgs.map((o) => [o.type, o.n])) as Record<string, number>;
    return { hospitals: byType.hospital ?? 0, insurers: byType.insurer ?? 0, tpas: byType.tpa ?? 0, schemes: schemes?.n ?? 0, policies: pols?.n ?? 0 };
  },

  async openReviews(db: DbOrTx, organizationId?: string) {
    const [r] = await db
      .select({ n: count() })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.status, "open"), organizationId ? eq(reviewRequests.organizationId, organizationId) : undefined));
    return r?.n ?? 0;
  },

  /** Platform-wide operational counts, for administrators only. */
  async adminCounts(db: DbOrTx) {
    const [[u], [pt], [ar], [jf]] = await Promise.all([
      db.select({ n: count() }).from(users).where(and(eq(users.isActive, true), isNull(users.deletedAt))),
      db.select({ n: count() }).from(patients).where(isNull(patients.deletedAt)),
      db.select({ n: count() }).from(accessRequests).where(eq(accessRequests.status, "pending")),
      db.select({ n: count() }).from(jobs).where(sql`${jobs.status} = 'failed'`),
    ]);
    return { activeUsers: u?.n ?? 0, patients: pt?.n ?? 0, pendingAccessRequests: ar?.n ?? 0, failedJobs: jf?.n ?? 0 };
  },
};
