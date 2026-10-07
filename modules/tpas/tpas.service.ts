import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { tpaInputSchema } from "@/modules/insurers/insurers.validation";
import { OrganizationRepository } from "@/modules/organizations/organizations.repository";
import { TpaRepository } from "./tpas.repository";

/** Third-party administrators: process claims on behalf of insurers. */
export const TpaService = {
  async list(ctx: ServiceContext, q: ListQuery) {
    requirePermission(ctx.principal, "insurer:read");
    // Payers only ever see their own products, so "policies serviced" counts only those (same rule as the policy scope).
    const p = ctx.principal;
    const countFor = p.orgType === "insurer" ? { insurerId: p.organizationId } : p.orgType === "tpa" ? { tpaId: p.organizationId } : {};
    return TpaRepository.list(ctx.db, q, countFor);
  },

  async get(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "insurer:read");
    const row = await TpaRepository.get(ctx.db, requireId(id, "TPA"));
    if (!row) throw new NotFoundError("TPA not found.");
    return row;
  },

  async options(ctx: ServiceContext) {
    requirePermission(ctx.principal, "insurer:read");
    return TpaRepository.options(ctx.db);
  },

  async create(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "insurer:manage");
    const d = parseOrThrow(tpaInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      if (await TpaRepository.codeTaken(tx, d.code)) throw new ConflictError(`Code ${d.code} is already used by another TPA.`);
      const org = await OrganizationRepository.insert(tx, "tpa", d.name);
      const row = await TpaRepository.insert(tx, { id: org.id, code: d.code, phone: d.phone ?? null, email: d.email ?? null });
      await AuditService.record(tx, { ...actorOf(ctx), action: "tpa.created", resourceType: "tpa", resourceId: org.id, newState: { name: d.name, code: d.code } });
      return row;
    });
  },

  async update(ctx: ServiceContext, id: string, input: unknown) {
    requirePermission(ctx.principal, "insurer:manage");
    const d = parseOrThrow(tpaInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      const before = await TpaRepository.get(tx, requireId(id, "TPA"));
      if (!before) throw new NotFoundError("TPA not found.");
      if (await TpaRepository.codeTaken(tx, d.code, id)) throw new ConflictError(`Code ${d.code} is already used by another TPA.`);
      await OrganizationRepository.rename(tx, id, d.name);
      const row = await TpaRepository.update(tx, id, { code: d.code, phone: d.phone ?? null, email: d.email ?? null });
      await AuditService.record(tx, {
        ...actorOf(ctx),
        action: "tpa.updated",
        resourceType: "tpa",
        resourceId: id,
        previousState: { name: before.name, code: before.tpa.code, phone: before.tpa.phone, email: before.tpa.email },
        newState: { name: d.name, code: d.code, phone: row.phone, email: row.email },
      });
      return row;
    });
  },
};
