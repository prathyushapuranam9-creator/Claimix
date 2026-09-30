import { describe, expect, it } from "vitest";
import { CLAIM_CHECKLIST, computeClaimChecklist, type ClaimChecklistInput } from "@/modules/claims/claims.checklist";
import { allowedClaimTransitions, canTransitionClaim, CLAIM_STATUSES, CLAIM_TERMINAL, type ClaimStatus } from "@/modules/claims/claims.workflow";
import type { Evaluation, RuleResult } from "@/modules/rules/engine/types";
import type { Side } from "@/modules/workflow/transition";

const SIDES: Side[] = ["hospital", "payer", "scheme_desk"];

describe("claim state machine", () => {
  it("supports submission, query, approval, partial approval, rejection and settlement", () => {
    expect(canTransitionClaim("draft", "submitted", "hospital")).toBe(true);
    expect(canTransitionClaim("submitted", "query", "payer")).toBe(true);
    expect(canTransitionClaim("query", "submitted", "hospital")).toBe(true);
    expect(canTransitionClaim("pending", "approved", "payer")).toBe(true);
    expect(canTransitionClaim("pending", "partially_approved", "payer")).toBe(true);
    expect(canTransitionClaim("pending", "rejected", "payer")).toBe(true);
    expect(canTransitionClaim("approved", "settled", "payer")).toBe(true);
    expect(canTransitionClaim("partially_approved", "settled", "scheme_desk")).toBe(true);
  });

  it("the hospital can never approve, reject or settle", () => {
    for (const to of ["pending", "query", "approved", "partially_approved", "rejected", "settled"] as ClaimStatus[]) {
      for (const from of CLAIM_STATUSES) expect(canTransitionClaim(from, to, "hospital"), `${from}->${to}`).toBe(false);
    }
  });

  it("settlement is only possible after approval", () => {
    for (const from of ["draft", "submitted", "pending", "query", "rejected", "cancelled"] as ClaimStatus[]) {
      for (const s of SIDES) expect(canTransitionClaim(from, "settled", s)).toBe(false);
    }
  });

  it("terminal states are final", () => {
    for (const from of CLAIM_TERMINAL) for (const s of SIDES) expect(allowedClaimTransitions(from, s)).toEqual([]);
  });

  it("an approved claim can't be cancelled or rejected afterwards", () => {
    for (const s of SIDES) {
      expect(canTransitionClaim("approved", "cancelled", s)).toBe(false);
      expect(canTransitionClaim("approved", "rejected", s)).toBe(false);
    }
  });
});

const r = (kind: string, category: RuleResult["category"], outcome: RuleResult["outcome"] = "PASS"): RuleResult => ({ code: kind, title: kind, kind, category, outcome, message: kind, missing: [], applicable: true });
const evaluation = (over: Record<string, RuleResult["outcome"]> = {}): Evaluation => ({
  overall: "PASS",
  results: [
    r("cover_active", "eligibility", over.cover_active),
    r("hospital_network", "eligibility", over.hospital_network),
    r("procedure_coverage", "coverage", over.procedure_coverage),
    r("sum_insured", "limit", over.sum_insured),
    r("required_documents", "document", over.required_documents),
    r("claim_submission_window", "claim", over.claim_submission_window),
  ],
  missingInformation: [],
  requiredDocuments: [],
  preauthRequired: null,
  estimate: null,
});
const manual = Object.fromEntries(CLAIM_CHECKLIST.filter((c) => c.source.type === "manual").map((c) => [c.key, { confirmed: true }]));
const base = (o: Partial<ClaimChecklistInput> = {}): ClaimChecklistInput => ({ evaluation: evaluation(), isCashless: true, preauthApproved: true, hasDates: true, hasTreatment: true, hasBill: true, manual, ...o });

describe("claim readiness checklist", () => {
  it("ready when everything is in place", () => {
    expect(computeClaimChecklist(base()).canSubmit).toBe(true);
  });

  it("cashless claims need an approved pre-auth; reimbursement claims don't", () => {
    expect(computeClaimChecklist(base({ preauthApproved: false })).canSubmit).toBe(false);
    expect(computeClaimChecklist(base({ isCashless: false, preauthApproved: false })).canSubmit).toBe(true);
  });

  it("missing claim documents, dates or bill block submission", () => {
    expect(computeClaimChecklist(base({ evaluation: evaluation({ required_documents: "FAIL" }) })).canSubmit).toBe(false);
    expect(computeClaimChecklist(base({ hasDates: false })).canSubmit).toBe(false);
    expect(computeClaimChecklist(base({ hasBill: false })).canSubmit).toBe(false);
  });

  it("a late submission is a hard failure needing an override reason", () => {
    const c = computeClaimChecklist(base({ evaluation: evaluation({ claim_submission_window: "FAIL" }) }));
    expect(c.canSubmit).toBe(true);
    expect(c.hardFailures.map((i) => i.key)).toEqual(["submission_window"]);
  });

  it("insufficient balance is a warning (patient pays the difference)", () => {
    const c = computeClaimChecklist(base({ evaluation: evaluation({ sum_insured: "FAIL" }) }));
    expect(c.hardFailures).toEqual([]);
    expect(c.warnings.map((i) => i.key)).toEqual(["limits"]);
  });
});
