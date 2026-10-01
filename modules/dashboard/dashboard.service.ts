import "server-only";
import type { ServiceContext } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/errors";
import { hasDashboard } from "@/lib/navigation";
import { can, requirePermission, scopeFor } from "@/lib/permissions/principal";
import { ReportRepository } from "@/modules/reports/reports.repository";
import { DashboardRepository } from "./dashboard.repository";

const PAYER_WAITING = ["submitted", "pending"];
const HOSPITAL_ACTION = ["draft", "query"];

/**
 * Role-specific dashboard data. The variant follows the caller's organization
 * type and permissions; every number comes from the same scoped queries as the
 * list pages, so a dashboard can only summarize what its viewer may open.
 */
export const DashboardService = {
  async forCaller(ctx: ServiceContext) {
    requirePermission(ctx.principal, "dashboard:view");
    const p = ctx.principal;
    if (!hasDashboard(p)) throw new ForbiddenError();
    const preauthScope = scopeFor(p, "preauth:read");
    const claimScope = scopeFor(p, "claim:read");

    const waiting = p.orgType === "hospital" ? HOSPITAL_ACTION : PAYER_WAITING;
    const [preauthStatus, claimStatus, financials, preauthTat, claimTat, actionPreauths, actionClaims, openReviews] = await Promise.all([
      preauthScope ? ReportRepository.statusCounts(ctx.db, "preauth", p, preauthScope) : {},
      claimScope ? ReportRepository.statusCounts(ctx.db, "claim", p, claimScope) : {},
      claimScope ? ReportRepository.claimFinancials(ctx.db, p, claimScope) : [],
      preauthScope ? ReportRepository.turnaround(ctx.db, "preauth", p, preauthScope) : null,
      claimScope ? ReportRepository.turnaround(ctx.db, "claim", p, claimScope) : null,
      preauthScope ? ReportRepository.recent(ctx.db, "preauth", p, preauthScope, 6, waiting) : [],
      claimScope ? ReportRepository.recent(ctx.db, "claim", p, claimScope, 6, waiting) : [],
      can(p, "assistant:review") ? DashboardRepository.openReviews(ctx.db, p.orgType === "platform" ? undefined : p.organizationId) : null,
    ]);
    const admin = can(p, "user:manage", "all") ? await DashboardRepository.adminCounts(ctx.db) : null;
    const variant = p.orgType === "platform" ? ("admin" as const) : p.orgType === "hospital" ? ("hospital" as const) : ("payer" as const);
    return { variant, preauthStatus, claimStatus, financials, preauthTat, claimTat, actionPreauths, actionClaims, openReviews, admin };
  },
};

export type DashboardData = Awaited<ReturnType<typeof DashboardService.forCaller>>;
