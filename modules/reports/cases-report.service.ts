import "server-only";
import { z } from "zod";
import type { ServiceContext } from "@/lib/auth/context";
import type { Scope } from "@/lib/permissions/catalog";
import { requirePermission, scopeFor } from "@/lib/permissions/principal";
import { CASE_SORTS, CaseReportRepository, type CaseSort, type SortDir } from "./cases.repository";
import type { DateRange } from "./reports.repository";

const RANK: Record<Scope, number> = { own: 1, organization: 2, all: 3 };

/** Cases the viewer may report on: report:view, narrowed by claim:read (never wider than the claims list). */
function claimScope(ctx: ServiceContext): Scope | null {
  const report = requirePermission(ctx.principal, "report:view");
  const read = scopeFor(ctx.principal, "claim:read");
  if (!read) return null;
  return RANK[report] <= RANK[read] ? report : read;
}

export const CASES_PAGE_SIZE = 20;

/** Lenient URL parsing: unknown values fall back to defaults instead of erroring. */
const optsSchema = z.object({
  sort: z.enum(Object.keys(CASE_SORTS) as [CaseSort, ...CaseSort[]]).catch("case"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export function parseCaseOptions(input: { sort?: string; dir?: string; page?: string }): { sort: CaseSort; dir: SortDir; page: number } {
  return optsSchema.parse(input);
}

export const CaseReportService = {
  async cases(ctx: ServiceContext, range: DateRange, opts: { sort: CaseSort; dir: SortDir; page: number }) {
    const scope = claimScope(ctx);
    if (!scope) return { total: 0, rows: [], page: 1, pageSize: CASES_PAGE_SIZE };
    const r = await CaseReportRepository.cases(ctx.db, ctx.principal, scope, range, { ...opts, pageSize: CASES_PAGE_SIZE });
    return { ...r, page: opts.page, pageSize: CASES_PAGE_SIZE };
  },

  async tatDistribution(ctx: ServiceContext, range: DateRange) {
    const scope = claimScope(ctx);
    if (!scope) return null;
    return CaseReportRepository.tatDistribution(ctx.db, ctx.principal, scope, range);
  },
};

export type CasesReport = Awaited<ReturnType<typeof CaseReportService.cases>>;
export type TatDistribution = NonNullable<Awaited<ReturnType<typeof CaseReportService.tatDistribution>>>;
