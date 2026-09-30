import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { OrganizationRepository } from "./organizations.repository";

export const OrganizationService = {
  /** Deactivating an organization blocks sign-in for all its users (enforced at session resolution). */
  async setActive(ctx: ServiceContext, id: string, active: boolean) {
    requirePermission(ctx.principal, "organization:manage");
    return ctx.db.transaction(async (tx) => {
      const org = await OrganizationRepository.get(tx, requireId(id, "Organization"));
      if (!org) throw new NotFoundError("Organization not found.");
      if (org.id === ctx.principal.organizationId && !active) {
        throw new ValidationError("You can't deactivate your own organization.");
      }
      await OrganizationRepository.setActive(tx, id, active);
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: active ? "organization.activated" : "organization.deactivated",
        resourceType: "organization",
        resourceId: id,
        previousState: { isActive: org.isActive },
        newState: { isActive: active },
      });
    });
  },
};
