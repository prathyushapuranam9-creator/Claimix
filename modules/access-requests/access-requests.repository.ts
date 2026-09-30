import "server-only";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accessRequests, users } from "@/db/schema";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";

export type AccessRequestStatus = "pending" | "approved" | "declined";

export const AccessRequestRepository = {
  async countRecentByIp(db: DbOrTx, ipHash: string, since: Date) {
    const [r] = await db
      .select({ n: count() })
      .from(accessRequests)
      .where(and(eq(accessRequests.ipHash, ipHash), gte(accessRequests.createdAt, since)));
    return r?.n ?? 0;
  },

  async hasPending(db: DbOrTx, email: string) {
    const [r] = await db
      .select({ id: accessRequests.id })
      .from(accessRequests)
      .where(and(eq(accessRequests.email, email), eq(accessRequests.status, "pending")))
      .limit(1);
    return !!r;
  },

  async insert(db: DbOrTx, values: typeof accessRequests.$inferInsert) {
    const [row] = await db.insert(accessRequests).values(values).returning({ id: accessRequests.id });
    return row!;
  },

  async list(db: DbOrTx, q: ListQuery, status?: AccessRequestStatus) {
    const where = and(
      status ? eq(accessRequests.status, status) : undefined,
      q.q
        ? or(
            ilike(accessRequests.fullName, likeContains(q.q)),
            ilike(accessRequests.email, likeContains(q.q)),
            ilike(accessRequests.organizationName, likeContains(q.q)),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({
          id: accessRequests.id,
          fullName: accessRequests.fullName,
          email: accessRequests.email,
          organizationName: accessRequests.organizationName,
          organizationType: accessRequests.organizationType,
          jobTitle: accessRequests.jobTitle,
          phone: accessRequests.phone,
          message: accessRequests.message,
          status: accessRequests.status,
          reviewNote: accessRequests.reviewNote,
          reviewedAt: accessRequests.reviewedAt,
          reviewerName: sql<string | null>`(select ${users.fullName} from ${users} where ${users.id} = ${accessRequests.reviewedBy})`,
          createdAt: accessRequests.createdAt,
        })
        .from(accessRequests)
        .where(where)
        .orderBy(desc(accessRequests.createdAt), desc(accessRequests.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ n: count() }).from(accessRequests).where(where),
    ]);
    return { rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  },

  async countByStatus(db: DbOrTx, status: AccessRequestStatus) {
    const [r] = await db.select({ n: count() }).from(accessRequests).where(eq(accessRequests.status, status));
    return r?.n ?? 0;
  },

  async exists(db: DbOrTx, id: string) {
    const [r] = await db.select({ id: accessRequests.id }).from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
    return !!r;
  },

  /** Decides a pending request; returns undefined if it isn't pending (or doesn't exist). */
  async decidePending(db: DbOrTx, id: string, v: { status: "approved" | "declined"; reviewNote: string | null; reviewedBy: string }) {
    const now = new Date();
    const [row] = await db
      .update(accessRequests)
      .set({ ...v, reviewedAt: now, updatedAt: now })
      .where(and(eq(accessRequests.id, id), eq(accessRequests.status, "pending")))
      .returning({ id: accessRequests.id });
    return row;
  },
};
