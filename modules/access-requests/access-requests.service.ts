import "server-only";
import type { Db } from "@/db/client";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError, RateLimitedError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { hmacHex } from "@/lib/security/crypto";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService, type RequestMeta } from "@/modules/audit/audit.service";
import { AccessRequestRepository, type AccessRequestStatus } from "./access-requests.repository";
import { accessRequestDecisionSchema, accessRequestSchema } from "./access-requests.validation";

export const ACCESS_REQUEST_LIMIT = { perIp: 5, windowMs: 60 * 60 * 1000 } as const;

/**
 * Public access requests. Submitting never creates an account or reveals whether
 * an email is known: duplicates and honeypot hits get the same response as a
 * genuine new request. Admins review requests and invite people via user admin.
 */
export const AccessRequestService = {
  async submit(db: Db, input: unknown, meta: RequestMeta, secret: string): Promise<void> {
    const d = parseOrThrow(accessRequestSchema, input);
    if (d.website) return; // bot: accept silently, store nothing
    const ipHash = hmacHex(`access-request:${meta.ipAddress ?? "unknown"}`, secret);
    const since = new Date(Date.now() - ACCESS_REQUEST_LIMIT.windowMs);
    if ((await AccessRequestRepository.countRecentByIp(db, ipHash, since)) >= ACCESS_REQUEST_LIMIT.perIp) {
      throw new RateLimitedError("Too many requests from this network. Please try again later.");
    }
    if (await AccessRequestRepository.hasPending(db, d.email)) return;

    await db.transaction(async (tx) => {
      const row = await AccessRequestRepository.insert(tx, {
        fullName: d.fullName,
        email: d.email,
        organizationName: d.organizationName,
        organizationType: d.organizationType,
        jobTitle: d.jobTitle,
        phone: d.phone,
        message: d.message,
        ipHash,
      });
      await AuditService.record(tx, {
        action: "access_request.created",
        resourceType: "access_request",
        resourceId: row.id,
        newState: { organizationType: d.organizationType },
        meta,
      });
    });
  },

  async list(ctx: ServiceContext, q: ListQuery, status?: AccessRequestStatus) {
    requirePermission(ctx.principal, "user:manage");
    return AccessRequestRepository.list(ctx.db, q, status);
  },

  async pendingCount(ctx: ServiceContext) {
    requirePermission(ctx.principal, "user:manage");
    return AccessRequestRepository.countByStatus(ctx.db, "pending");
  },

  /** Records the admin's decision. Approval does not create an account — the admin invites the person separately. */
  async decide(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "user:manage");
    requireId(id, "Access request");
    const d = parseOrThrow(accessRequestDecisionSchema, input);
    return ctx.db.transaction(async (tx) => {
      const row = await AccessRequestRepository.decidePending(tx, id, { status: d.decision, reviewNote: d.note ?? null, reviewedBy: ctx.principal.userId });
      if (!row) {
        if (!(await AccessRequestRepository.exists(tx, id))) throw new NotFoundError("Access request not found.");
        throw new ConflictError("This request has already been reviewed.");
      }
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: `access_request.${d.decision}`,
        resourceType: "access_request",
        resourceId: id,
        previousState: { status: "pending" },
        newState: { status: d.decision },
      });
      return row;
    });
  },
};
