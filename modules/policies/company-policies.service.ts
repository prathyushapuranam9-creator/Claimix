import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { organizations } from "@/db/schema";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Principal } from "@/lib/permissions/principal";
import { requireId } from "@/lib/validation";
import type { SessionUser } from "@/modules/auth/auth.service";
import { PolicyService } from "./policies.service";

/** What the dashboard needs to know about the signed-in account's testing access (from the real account). */
type Viewer = Pick<SessionUser, "canSwitchContext" | "contextOrganizationId">;

export interface CompanyPolicyOption {
  id: string;
  name: string;
  productType: string;
}

/**
 * Insurance Company → Policy → policy content, for the dashboard's "Insurance portal testing" block.
 *
 * A company's policies are read exactly as that company's own reviewer would read them: through the existing
 * policy scope (an insurer's products, or those a TPA administers). Which companies may be browsed follows the
 * testing-context rule: administrators and flagged testing logins any active insurer / TPA, an ordinary insurer or
 * TPA reviewer only its own organization. Anything else is refused on the server, whatever the request says.
 */
export const CompanyPolicyService = {
  /** May this account browse that company at all? */
  allowed(viewer: Viewer, companyId: string) {
    return viewer.canSwitchContext && (viewer.contextOrganizationId === null || viewer.contextOrganizationId === companyId);
  },

  /** The company's own view of policies, as a scoped context; refuses companies the account may not browse. */
  async asCompany(ctx: ServiceContext, viewer: Viewer, companyId: string): Promise<ServiceContext> {
    const id = requireId(companyId, "Insurance company");
    if (!this.allowed(viewer, id)) throw new ForbiddenError("You can only view your own company's policies.");
    const [org] = await ctx.db
      .select({ type: organizations.type })
      .from(organizations)
      .where(and(eq(organizations.id, id), isNull(organizations.deletedAt), eq(organizations.isActive, true)))
      .limit(1);
    if (!org || (org.type !== "insurer" && org.type !== "tpa")) throw new NotFoundError("Insurance company not found.");
    const principal: Principal = {
      ...ctx.principal,
      organizationId: id,
      orgType: org.type,
      patientId: null,
      // The company's full list, whatever policy the portal is currently narrowed to.
      policyId: null,
      permissions: new Map([["policy:read", "organization"]]),
    };
    return { ...ctx, principal };
  },

  /** Active policies belonging to the company (insurer's products / TPA-administered), by name. */
  async list(ctx: ServiceContext, viewer: Viewer, companyId: string): Promise<CompanyPolicyOption[]> {
    const as = await this.asCompany(ctx, viewer, companyId);
    // All of them in one list (a company has a handful of products; the dropdown scrolls if there are many).
    const { rows } = await PolicyService.list(as, { page: 1, pageSize: 500 }, {});
    return rows.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name, productType: r.productType }));
  },

  /** One policy with its active rules and packages, only if it belongs to that company (audited as a view). */
  async get(ctx: ServiceContext, viewer: Viewer, companyId: string, policyId: string) {
    const as = await this.asCompany(ctx, viewer, companyId);
    return PolicyService.get(as, requireId(policyId, "Policy"));
  },
};
