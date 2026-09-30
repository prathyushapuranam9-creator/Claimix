import type { Side } from "@/modules/workflow/transition";

/**
 * Claim state machine — the only definition of allowed claim status changes.
 * "rejected" and "settled" additionally require a payer response / paid
 * settlement, enforced by the service AND by database triggers.
 */
export const CLAIM_STATUSES = ["draft", "submitted", "pending", "query", "approved", "partially_approved", "rejected", "settled", "cancelled"] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const PAYER: Side[] = ["payer", "scheme_desk"];

const T: Record<ClaimStatus, Partial<Record<ClaimStatus, Side[]>>> = {
  draft: { submitted: ["hospital"], cancelled: ["hospital"] },
  submitted: { pending: PAYER, query: PAYER, approved: PAYER, partially_approved: PAYER, rejected: PAYER, cancelled: ["hospital"] },
  pending: { query: PAYER, approved: PAYER, partially_approved: PAYER, rejected: PAYER, cancelled: ["hospital"] },
  query: { submitted: ["hospital"], rejected: PAYER, cancelled: ["hospital"] },
  approved: { settled: PAYER },
  partially_approved: { settled: PAYER, query: PAYER },
  rejected: {},
  settled: {},
  cancelled: {},
};

export const CLAIM_PAYER_DECISIONS = new Set<ClaimStatus>(["query", "approved", "partially_approved", "rejected"]);
export const CLAIM_TERMINAL = new Set<ClaimStatus>(["rejected", "settled", "cancelled"]);
export const CLAIM_EDITABLE = new Set<ClaimStatus>(["draft", "query"]);
export const CLAIM_DOCUMENTS_ALLOWED = new Set<ClaimStatus>(["draft", "submitted", "pending", "query"]);

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus, side: Side | null): boolean {
  if (!side) return false;
  return T[from]?.[to]?.includes(side) ?? false;
}

export function allowedClaimTransitions(from: ClaimStatus, side: Side | null): ClaimStatus[] {
  if (!side) return [];
  return (Object.entries(T[from] ?? {}) as [ClaimStatus, Side[]][]).filter(([, s]) => s.includes(side)).map(([to]) => to);
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  pending: "Under assessment",
  query: "Query raised",
  approved: "Approved",
  partially_approved: "Partially approved",
  rejected: "Rejected",
  settled: "Settled",
  cancelled: "Cancelled",
};

export const CLAIM_STATUS_TONE: Record<ClaimStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  submitted: "info",
  pending: "warning",
  query: "warning",
  approved: "success",
  partially_approved: "success",
  rejected: "danger",
  settled: "success",
  cancelled: "neutral",
};
