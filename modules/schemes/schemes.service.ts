import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions/principal";
import { requireId } from "@/lib/validation";
import { PolicyService } from "@/modules/policies/policies.service";
import { SchemeQueries } from "./schemes.repository";

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
};
