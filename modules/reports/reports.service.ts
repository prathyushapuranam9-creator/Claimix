import "server-only";
import { z } from "zod";
import type { ServiceContext } from "@/lib/auth/context";
import type { Scope } from "@/lib/permissions/catalog";
import { requirePermission, scopeFor } from "@/lib/permissions/principal";
import { zOptionalDate } from "@/lib/validation";
import { ReportRepository, type DateRange } from "./reports.repository";

/** Lenient range parsing from the URL: invalid or reversed dates are dropped, never an error. */
const rangeSchema = z.object({ from: zOptionalDate.catch(undefined), to: zOptionalDate.catch(undefined) });

export function parseRange(input: { from?: string; to?: string }): DateRange {
  const r = rangeSchema.parse(input);
  if (r.from && r.to && r.from > r.to) return { from: r.to, to: r.from };
  return r;
}

const RANK: Record<Scope, number> = { own: 1, organization: 2, all: 3 };
function narrower(a: Scope, b: Scope | null): Scope | null {
  return b === null ? null : RANK[a] <= RANK[b] ? a : b;
}

/**
 * Operational reports. Requires report:view; each dataset is additionally limited
 * by the viewer's read scope for that case type, so a report never includes a row
 * the viewer couldn't open in the list pages.
 */
export const ReportService = {
  async overview(ctx: ServiceContext, range: DateRange) {
    const reportScope = requirePermission(ctx.principal, "report:view");
    // Case scopes are the narrower of report:view and the case read permission.
    const preauth = narrower(reportScope, scopeFor(ctx.principal, "preauth:read"));
    const claim = narrower(reportScope, scopeFor(ctx.principal, "claim:read"));
    const [preauthStatus, claimStatus, financials, monthly, preauthTat, claimTat, reasons] = await Promise.all([
      preauth ? ReportRepository.statusCounts(ctx.db, "preauth", ctx.principal, preauth, range) : null,
      claim ? ReportRepository.statusCounts(ctx.db, "claim", ctx.principal, claim, range) : null,
      claim ? ReportRepository.claimFinancials(ctx.db, ctx.principal, claim, range) : [],
      claim ? ReportRepository.claimsByMonth(ctx.db, ctx.principal, claim, range) : [],
      preauth ? ReportRepository.turnaround(ctx.db, "preauth", ctx.principal, preauth, range) : null,
      claim ? ReportRepository.turnaround(ctx.db, "claim", ctx.principal, claim, range) : null,
      ReportRepository.topReasons(ctx.db, ctx.principal, { preauth, claim }, range),
    ]);
    return { preauthStatus, claimStatus, financials, monthly, preauthTat, claimTat, reasons };
  },
};

export type ReportOverview = Awaited<ReturnType<typeof ReportService.overview>>;
