import type { Side } from "@/modules/workflow/transition";

/**
 * Pre-authorization state machine — the ONLY place that defines which status
 * changes are allowed and by whom. UI components ask `allowedTransitions()`;
 * the service enforces `canTransition()` on the server for every change.
 */
export const PREAUTH_STATUSES = [
  "draft", "submitted", "pending", "query", "approved", "partially_approved", "rejected", "cancelled", "final_approved", "settled",
] as const;

export type PreauthStatus = (typeof PREAUTH_STATUSES)[number];

export type { Side };

type PayerSide = "payer" | "scheme_desk";
const PAYER: PayerSide[] = ["payer", "scheme_desk"];

const T: Record<PreauthStatus, Partial<Record<PreauthStatus, Side[]>>> = {
  draft: { submitted: ["hospital"], cancelled: ["hospital"] },
  submitted: { pending: PAYER, query: PAYER, approved: PAYER, partially_approved: PAYER, rejected: PAYER, cancelled: ["hospital"] },
  pending: { query: PAYER, approved: PAYER, partially_approved: PAYER, rejected: PAYER, cancelled: ["hospital"] },
  query: { submitted: ["hospital"], rejected: PAYER, cancelled: ["hospital"] },
  approved: { final_approved: PAYER, cancelled: ["hospital"] },
  partially_approved: { final_approved: PAYER, query: PAYER, cancelled: ["hospital"] },
  final_approved: { settled: PAYER },
  rejected: {},
  cancelled: {},
  settled: {},
};

/** Transitions that record the payer's decision and therefore need a payer response. */
export const PAYER_DECISIONS = new Set<PreauthStatus>(["query", "approved", "partially_approved", "rejected", "final_approved"]);

export const TERMINAL = new Set<PreauthStatus>(["rejected", "cancelled", "settled"]);

/** Statuses in which the hospital may still edit case details or add documents. */
export const HOSPITAL_EDITABLE = new Set<PreauthStatus>(["draft", "query"]);
export const DOCUMENTS_ALLOWED = new Set<PreauthStatus>(["draft", "submitted", "pending", "query", "approved", "partially_approved"]);

export function canTransition(from: PreauthStatus, to: PreauthStatus, side: Side | null): boolean {
  if (!side) return false;
  return T[from]?.[to]?.includes(side) ?? false;
}

export function allowedTransitions(from: PreauthStatus, side: Side | null): PreauthStatus[] {
  if (!side) return [];
  return (Object.entries(T[from] ?? {}) as [PreauthStatus, Side[]][]).filter(([, sides]) => sides.includes(side)).map(([to]) => to);
}

export const STATUS_LABEL: Record<PreauthStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  pending: "Under review",
  query: "Query raised",
  approved: "Approved",
  partially_approved: "Partially approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  final_approved: "Final approved",
  settled: "Settled",
};

export const STATUS_TONE: Record<PreauthStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  submitted: "info",
  pending: "warning",
  query: "warning",
  approved: "success",
  partially_approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  final_approved: "success",
  settled: "success",
};
