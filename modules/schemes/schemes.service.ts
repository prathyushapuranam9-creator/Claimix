import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { parseOrThrow, requireId } from "@/lib/validation";
import { actorOf, AuditService } from "@/modules/audit/audit.service";
import { PolicyService } from "@/modules/policies/policies.service";
import { SchemeQueries, SchemeRepository } from "./schemes.repository";
import { schemeInputSchema } from "./schemes.validation";

/** Government schemes are reference information, kept apart from private insurance. */
export const SchemeService = {
  async list(ctx: ServiceContext) {
    requirePermission(ctx.principal, "policy:read");
    return SchemeQueries.list(ctx.db);
  },

  async get(ctx: ServiceContext, id: string) {
    requirePermission(ctx.principal, "policy:read");
    const scheme = await SchemeQueries.get(ctx.db, requireId(id, "Scheme"));
    if (!scheme) throw new NotFoundError("Scheme not found.");
    const covers = await PolicyService.list(ctx, { page: 1, pageSize: 50 }, { category: "government", schemeId: id });
    return { scheme, covers: covers.rows };
  },

  /** Platform admins register a scheme; its covers and empanelment are then added as for insurers. */
  async create(ctx: ServiceContext, input: unknown) {
    requirePermission(ctx.principal, "policy:manage");
    const d = parseOrThrow(schemeInputSchema, input);
    return ctx.db.transaction(async (tx) => {
      if (await SchemeRepository.codeTaken(tx, d.code)) throw new ConflictError(`Code ${d.code} is already used by another scheme.`);
      const row = await SchemeRepository.insert(tx, { code: d.code, name: d.name, authority: d.authority, description: d.description ?? null });
      await AuditService.record(tx, { ...actorOf(ctx), action: "scheme.created", resourceType: "scheme", resourceId: row.id, newState: { code: d.code, name: d.name } });
      return row;
    });
  },
};
