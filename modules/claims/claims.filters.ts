import { param } from "@/lib/pagination";
import type { ClaimFilters, ClaimSort } from "./claims.repository";
import type { ClaimStatus } from "./claims.workflow";

type SP = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Status views (spec: status + approval-status filters). */
export const CLAIM_VIEWS: Record<string, { label: string; status?: ClaimStatus[] }> = {
  open: { label: "Open", status: ["draft", "submitted", "pending", "query"] },
  action: { label: "Needs action", status: ["draft", "query"] },
  review: { label: "Under assessment", status: ["submitted", "pending"] },
  approved: { label: "Approved", status: ["approved", "partially_approved"] },
  rejected: { label: "Rejected", status: ["rejected"] },
  settled: { label: "Settled", status: ["settled"] },
  all: { label: "All" },
};

/**
 * Parses list/export filters from the URL. Anything malformed is ignored (never
 * passed to the database), so the page and the export always agree.
 */
export function parseClaimFilters(sp: SP): { view: string; filters: ClaimFilters; sort: ClaimSort } {
  const view = param(sp, "view") ?? "open";
  const id = (k: string) => {
    const v = param(sp, k);
    return v && UUID.test(v) ? v : undefined;
  };
  const date = (k: string) => {
    const v = param(sp, k);
    return v && DATE.test(v) ? v : undefined;
  };
  const type = param(sp, "type");
  const sort = param(sp, "sort");
  return {
    view: CLAIM_VIEWS[view] ? view : "open",
    filters: {
      status: (CLAIM_VIEWS[view] ?? CLAIM_VIEWS.open!).status,
      insurerId: id("insurer"),
      tpaId: id("tpa"),
      schemeId: id("scheme"),
      hospitalId: id("hospital"),
      claimType: type === "cashless" || type === "reimbursement" ? type : undefined,
      from: date("from"),
      to: date("to"),
    },
    sort: sort === "admission" || sort === "amount" ? sort : "updated",
  };
}

/** Query string for the current filters (for pagination and export links). */
export function claimFilterParams(sp: SP): Record<string, string | undefined> {
  const keys = ["q", "view", "insurer", "tpa", "scheme", "hospital", "type", "from", "to", "sort"];
  return Object.fromEntries(keys.map((k) => [k, param(sp, k)]));
}
