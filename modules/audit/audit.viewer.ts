import "server-only";
import { and, count, desc, eq, gte, ilike, lt, type SQL } from "drizzle-orm";
import { auditLogs, organizations, users } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { likeContains, offsetOf, type ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { actorOf, AuditService } from "./audit.service";

export interface AuditFilters {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actor?: string;
  from?: string;
  to?: string;
}

export const AUDIT_RESOURCE_TYPES = ["preauth", "claim", "patient", "document", "policy", "rule_version", "rule", "rule_evaluation", "user", "organization", "hospital", "insurer", "tpa", "beneficiary", "rejection_reason"] as const;

/** Read-only audit trail viewer. Scope: all (platform), own organization, or own actions. */
export const AuditViewer = {
  async list(ctx: ServiceContext, q: ListQuery, f: AuditFilters) {
    const scope = requirePermission(ctx.principal, "audit:read");
    const scopeWhere: SQL | undefined =
      scope === "all" ? undefined : scope === "organization" ? eq(auditLogs.organizationId, ctx.principal.organizationId) : eq(auditLogs.actorUserId, ctx.principal.userId);
    const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00+05:30`) + 86_400_000);
    const where = and(
      scopeWhere,
      f.action ? ilike(auditLogs.action, `${f.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
      f.resourceType ? eq(auditLogs.resourceType, f.resourceType) : undefined,
      f.resourceId ? eq(auditLogs.resourceId, f.resourceId) : undefined,
      f.actor ? ilike(users.email, likeContains(f.actor)) : undefined,
      f.from ? gte(auditLogs.occurredAt, new Date(`${f.from}T00:00:00+05:30`)) : undefined,
      f.to ? lt(auditLogs.occurredAt, nextDay(f.to)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select({
          id: auditLogs.id,
          occurredAt: auditLogs.occurredAt,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          previousState: auditLogs.previousState,
          newState: auditLogs.newState,
          ipAddress: auditLogs.ipAddress,
          requestId: auditLogs.requestId,
          actorName: users.fullName,
          actorEmail: users.email,
          orgName: organizations.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .leftJoin(organizations, eq(organizations.id, auditLogs.organizationId))
        .where(where)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      ctx.db.select({ n: count() }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where),
    ]);
    // Access to the audit trail is itself recorded.
    await AuditService.record(ctx.db, { ...actorOf(ctx), action: "audit.viewed", resourceType: "audit_log", newState: { filters: { ...f }, page: q.page } });
    return { rows, total: total?.n ?? 0 };
  },
};
