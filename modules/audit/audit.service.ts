import "server-only";
import type { DbOrTx } from "@/db/client";
import { auditLogs } from "@/db/schema";

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEvent {
  actorUserId?: string | null;
  organizationId?: string | null;
  sessionId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  meta?: RequestMeta;
}

/**
 * Centralized, append-only audit trail. Pass the caller's transaction so the audit
 * row commits (or rolls back) atomically with the change it describes.
 * Never put passwords, tokens or raw documents into previous/new state.
 */
export const AuditService = {
  async record(db: DbOrTx, e: AuditEvent): Promise<void> {
    await db.insert(auditLogs).values({
      actorUserId: e.actorUserId ?? null,
      organizationId: e.organizationId ?? null,
      sessionId: e.sessionId ?? null,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      previousState: e.previousState ?? null,
      newState: e.newState ?? null,
      ipAddress: validIp(e.meta?.ipAddress),
      userAgent: e.meta?.userAgent?.slice(0, 400) ?? null,
      requestId: e.meta?.requestId ?? null,
    });
  },
};

function validIp(ip?: string | null): string | null {
  if (!ip) return null;
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/** Actor/session/request fields for an audit event, taken from a service context. */
export function actorOf(ctx: {
  principal: { userId: string; organizationId: string; sessionId: string };
  meta: RequestMeta;
}): Pick<AuditEvent, "actorUserId" | "organizationId" | "sessionId" | "meta"> {
  return {
    actorUserId: ctx.principal.userId,
    organizationId: ctx.principal.organizationId,
    sessionId: ctx.principal.sessionId,
    meta: ctx.meta,
  };
}
