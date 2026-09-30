import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { payerResponses, queries, rejectionReasons, statusHistory, users } from "@/db/schema";

type Subject = "preauth" | "claim";

/** Timeline, payer responses and queries shared by pre-authorizations and claims. */
export const HistoryRepository = {
  async insert(db: DbOrTx, values: typeof statusHistory.$inferInsert) {
    await db.insert(statusHistory).values(values);
  },

  async timeline(db: DbOrTx, subjectType: Subject, id: string) {
    return db
      .select({
        id: statusHistory.id,
        fromStatus: statusHistory.fromStatus,
        toStatus: statusHistory.toStatus,
        reason: statusHistory.reason,
        message: statusHistory.message,
        requiredAction: statusHistory.requiredAction,
        requiredDocuments: statusHistory.requiredDocuments,
        responsibleTeam: statusHistory.responsibleTeam,
        createdAt: statusHistory.createdAt,
        actorName: users.fullName,
      })
      .from(statusHistory)
      .leftJoin(users, eq(users.id, statusHistory.actorUserId))
      .where(and(eq(statusHistory.subjectType, subjectType), eq(statusHistory.subjectId, id)))
      .orderBy(asc(statusHistory.createdAt));
  },

  async insertPayerResponse(db: DbOrTx, values: typeof payerResponses.$inferInsert) {
    const [row] = await db.insert(payerResponses).values(values).returning();
    return row!;
  },

  async payerResponses(db: DbOrTx, subjectType: Subject, id: string) {
    return db
      .select({
        id: payerResponses.id,
        decision: payerResponses.decision,
        approvedAmount: payerResponses.approvedAmount,
        remarks: payerResponses.remarks,
        payerReference: payerResponses.payerReference,
        createdAt: payerResponses.createdAt,
        reasonTitle: rejectionReasons.title,
        reasonMeaning: rejectionReasons.meaning,
        reasonCheck: rejectionReasons.whatToCheck,
        reasonAction: rejectionReasons.requiredAction,
        recordedByName: users.fullName,
      })
      .from(payerResponses)
      .leftJoin(rejectionReasons, eq(rejectionReasons.id, payerResponses.rejectionReasonId))
      .leftJoin(users, eq(users.id, payerResponses.recordedBy))
      .where(and(eq(payerResponses.subjectType, subjectType), eq(payerResponses.subjectId, id)))
      .orderBy(desc(payerResponses.createdAt));
  },

  async insertQuery(db: DbOrTx, values: typeof queries.$inferInsert) {
    await db.insert(queries).values(values);
  },

  async respondToQueries(db: DbOrTx, subjectType: Subject, id: string, userId: string, message: string) {
    await db
      .update(queries)
      .set({ status: "responded", responseMessage: message, respondedBy: userId, respondedAt: new Date() })
      .where(and(eq(queries.subjectType, subjectType), eq(queries.subjectId, id), eq(queries.status, "open")));
  },

  async queries(db: DbOrTx, subjectType: Subject, id: string) {
    return db
      .select({ query: queries, reasonTitle: rejectionReasons.title, reasonAction: rejectionReasons.requiredAction })
      .from(queries)
      .leftJoin(rejectionReasons, eq(rejectionReasons.id, queries.reasonId))
      .where(and(eq(queries.subjectType, subjectType), eq(queries.subjectId, id)))
      .orderBy(desc(queries.createdAt));
  },

  async reason(db: DbOrTx, id: string) {
    const [row] = await db.select().from(rejectionReasons).where(eq(rejectionReasons.id, id)).limit(1);
    return row;
  },
};
