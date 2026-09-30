import "server-only";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { rejectionReasons } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";
import { likeContains } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";

import { reasonInputSchema } from "./reasons.validation";

export { REASON_KINDS, reasonInputSchema, type ReasonInput } from "./reasons.validation";

/**
 * Query & rejection reasons: general guidance (reason → meaning → what to check →
 * required action). Reference information; the payer's actual decision always
 * comes from their recorded response.
 */
export const ReasonService = {
  async list(ctx: ServiceContext, f: { q?: string; kind?: "query" | "rejection" }) {
    requirePermission(ctx.principal, "policy:read");
    return ctx.db
      .select()
      .from(rejectionReasons)
      .where(and(
        f.q ? or(ilike(rejectionReasons.title, likeContains(f.q)), ilike(rejectionReasons.meaning, likeContains(f.q))) : undefined,
        f.kind ? or(eq(rejectionReasons.kind, f.kind), eq(rejectionReasons.kind, "both")) : undefined,
      ))
      .orderBy(asc(rejectionReasons.title));
  },

  async get(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "policy:read");
    const [row] = await ctx.db.select().from(rejectionReasons).where(eq(rejectionReasons.id, requireId(id, "Reason"))).limit(1);
    if (!row) throw new NotFoundError("Reason not found.");
    return row;
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(reasonInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const [before] = await tx.select().from(rejectionReasons).where(eq(rejectionReasons.id, requireId(id, "Reason"))).limit(1);
      if (!before) throw new NotFoundError("Reason not found.");
      const [row] = await tx.update(rejectionReasons).set(d).where(eq(rejectionReasons.id, id)).returning();
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "reason.updated",
        resourceType: "rejection_reason",
        resourceId: id,
        previousState: { title: before.title, kind: before.kind, meaning: before.meaning, whatToCheck: before.whatToCheck, requiredAction: before.requiredAction },
        newState: d,
      });
      return row!;
    });
  },
};
