import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { InsurerRepository } from "./insurers.repository";
import { insurerInputSchema } from "./insurers.validation";

/** Insurers: private payer organizations. Reference data readable with insurer:read. */
export const InsurerService = {
  async list(ctx: ServiceContext, q: ListQuery) {
    requirePermission(ctx.principal, "insurer:read");
    return InsurerRepository.list(ctx.db, q);
  },

  async get(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "insurer:read");
    const row = await InsurerRepository.get(ctx.db, requireId(id, "Insurer"));
    if (!row) throw new NotFoundError("Insurer not found.");
    return row;
  },

  async options(ctx: ServiceContext) {
    requirePermission(ctx.principal, "insurer:read");
    return InsurerRepository.options(ctx.db);
  },

  async create(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "insurer:manage");
    const d = parseOrThrow(insurerInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      if (await InsurerRepository.codeTaken(tx, d.code)) throw new ConflictError(`Code ${d.code} is already used by another insurer.`);
      const org = await OrganizationRepository.insert(tx, "insurer", d.name);
      const row = await InsurerRepository.insert(tx, { id: org.id, code: d.code, claimsPhone: d.claimsPhone ?? null, claimsEmail: d.claimsEmail ?? null, website: d.website ?? null });
      await AuditService.record(tx, { ...actorOf(ctx), action: "insurer.created", resourceType: "insurer", resourceId: org.id, newState: { name: d.name, code: d.code } });
      return row;
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "insurer:manage");
    const d = parseOrThrow(insurerInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const before = await InsurerRepository.get(tx, requireId(id, "Insurer"));
      if (!before) throw new NotFoundError("Insurer not found.");
      if (await InsurerRepository.codeTaken(tx, d.code, id)) throw new ConflictError(`Code ${d.code} is already used by another insurer.`);
      await OrganizationRepository.rename(tx, id, d.name);
      const row = await InsurerRepository.update(tx, id, { code: d.code, claimsPhone: d.claimsPhone ?? null, claimsEmail: d.claimsEmail ?? null, website: d.website ?? null });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "insurer.updated",
        resourceType: "insurer",
        resourceId: id,
        previousState: { name: before.name, code: before.insurer.code, claimsPhone: before.insurer.claimsPhone, claimsEmail: before.insurer.claimsEmail, website: before.insurer.website },
        newState: { name: d.name, code: d.code, claimsPhone: row.claimsPhone, claimsEmail: row.claimsEmail, website: row.website },
      });
      return row;
    });
  },
};
