import { describe, expect, it } from "vitest";
import { CHECKLIST, computePreauthChecklist as computeChecklist, type PreauthChecklistInput as ChecklistInput } from "@/modules/preauth/preauth.checklist";
import { allowedTransitions, canTransition, PREAUTH_STATUSES, TERMINAL, type PreauthStatus, type Side } from "@/modules/preauth/preauth.workflow";
import type { Evaluation, RuleResult } from "@/modules/rules/engine/types";

describe("pre-auth state machine", () => {
  const SIDES: Side[] = ["hospital", "payer", "scheme_desk"];

  it("allows the documented happy path", () => {
    expect(canTransition("draft", "submitted", "hospital")).toBe(true);
    expect(canTransition("submitted", "pending", "payer")).toBe(true);
    expect(canTransition("pending", "query", "payer")).toBe(true);
    expect(canTransition("query", "submitted", "hospital")).toBe(true);
    expect(canTransition("submitted", "approved", "payer")).toBe(true);
    expect(canTransition("approved", "final_approved", "payer")).toBe(true);
    expect(canTransition("final_approved", "settled", "payer")).toBe(true);
  });

  it("only the payer side can decide; the hospital can never approve or reject", () => {
    for (const to of ["pending", "query", "approved", "partially_approved", "rejected", "final_approved", "settled"] as PreauthStatus[]) {
      for (const from of PREAUTH_STATUSES) expect(canTransition(from, to, "hospital"), `${from}->${to}`).toBe(false);
    }
  });

  it("the payer side can never submit or cancel on the hospital's behalf", () => {
    for (const from of PREAUTH_STATUSES) {
      expect(canTransition(from, "submitted", "payer")).toBe(false);
      expect(canTransition(from, "cancelled", "payer")).toBe(false);
    }
  });

  it("terminal states have no way out, for anyone", () => {
    for (const from of TERMINAL) for (const s of SIDES) expect(allowedTransitions(from, s)).toEqual([]);
  });

  it("drafts can't be decided and can't skip straight to approval", () => {
    for (const s of SIDES) {
      expect(canTransition("draft", "approved", s)).toBe(false);
      expect(canTransition("draft", "settled", s)).toBe(false);
    }
  });

  it("no side means no transitions (read-only viewers, admins, patients)", () => {
    for (const from of PREAUTH_STATUSES) expect(allowedTransitions(from, null)).toEqual([]);
  });

  it("self-transitions are never allowed", () => {
    for (const s of PREAUTH_STATUSES) for (const side of SIDES) expect(canTransition(s, s, side)).toBe(false);
  });
});

const res = (kind: string, category: RuleResult["category"], outcome: RuleResult["outcome"]): RuleResult => ({ code: kind, title: kind, kind, category, outcome, message: `${kind} ${outcome}`, missing: [], applicable: true });

function evaluation(over: Partial<Record<string, RuleResult["outcome"]>> = {}): Evaluation {
  const o = (k: string) => over[k] ?? "PASS";
  const results = [
    res("cover_active", "eligibility", o("cover_active")),
    res("age_range", "eligibility", o("age_range")),
    res("hospital_network", "eligibility", o("hospital_network")),
    res("procedure_coverage", "coverage", o("procedure_coverage")),
    res("initial_waiting", "waiting_period", o("initial_waiting")),
    res("ped_waiting", "ped", o("ped_waiting")),
    res("excluded_diagnoses", "exclusion", o("excluded_diagnoses")),
    res("sum_insured", "limit", o("sum_insured")),
    res("room_rent_limit", "limit", o("room_rent_limit")),
    res("required_documents", "document", o("required_documents")),
    res("preauth_required", "preauth", "PASS"),
  ];
  return { overall: "PASS", results, missingInformation: [], requiredDocuments: [], preauthRequired: true, estimate: null };
}

const allManual = Object.fromEntries(CHECKLIST.filter((c) => c.source.type === "manual").map((c) => [c.key, { confirmed: true }]));
const base = (over: Partial<ChecklistInput> = {}): ChecklistInput => ({ evaluation: evaluation(), hasPolicy: true, hasDiagnosis: true, hasProcedure: true, hasEstimate: true, manual: allManual, ...over });

describe("pre-auth checklist", () => {
  it("has exactly the 20 required items", () => {
    expect(CHECKLIST).toHaveLength(20);
    expect(new Set(CHECKLIST.map((c) => c.key)).size).toBe(20);
  });

  it("everything checked and confirmed → can submit", () => {
    const c = computeChecklist(base());
    expect(c.canSubmit).toBe(true);
    expect(c.hardFailures).toEqual([]);
  });

  it("no rules run yet → cannot submit", () => {
    expect(computeChecklist(base({ evaluation: null })).canSubmit).toBe(false);
  });

  it("unconfirmed manual items block submission", () => {
    const c = computeChecklist(base({ manual: {} }));
    expect(c.canSubmit).toBe(false);
    expect(c.incomplete.map((i) => i.key)).toEqual(expect.arrayContaining(["patient_identified", "diagnosis_confirmed", "procedure_confirmed", "details_match"]));
  });

  it("diagnosis/procedure can't be confirmed before they're selected", () => {
    const c = computeChecklist(base({ hasDiagnosis: false }));
    const item = c.items.find((i) => i.key === "diagnosis_confirmed")!;
    expect(item.complete).toBe(false);
    expect(item.confirmable).toBe(false);
  });

  it("missing estimate blocks submission", () => {
    expect(computeChecklist(base({ hasEstimate: false })).canSubmit).toBe(false);
  });

  it("NEEDS_VERIFICATION blocks until a human verification note is recorded", () => {
    const pending = computeChecklist(base({ evaluation: evaluation({ hospital_network: "NEEDS_VERIFICATION" }) }));
    expect(pending.canSubmit).toBe(false);
    const verified = computeChecklist(base({ evaluation: evaluation({ hospital_network: "NEEDS_VERIFICATION" }), manual: { ...allManual, hospital_network: { confirmed: true, note: "Confirmed with TPA desk" } } }));
    expect(verified.canSubmit).toBe(true);
  });

  it("missing documents (a blocker FAIL) cannot be overridden", () => {
    const c = computeChecklist(base({ evaluation: evaluation({ required_documents: "FAIL" }), manual: { ...allManual, documents_uploaded: { confirmed: true, note: "please let me" } } }));
    expect(c.canSubmit).toBe(false);
  });

  it("hard eligibility failures are reported (submission then needs an override reason)", () => {
    const c = computeChecklist(base({ evaluation: evaluation({ cover_active: "FAIL", excluded_diagnoses: "FAIL" }) }));
    expect(c.canSubmit).toBe(true);
    expect(c.hardFailures.map((i) => i.key).sort()).toEqual(["exclusions", "policy_active"]);
  });

  it("limit failures are warnings (patient pays the difference), not blockers", () => {
    const c = computeChecklist(base({ evaluation: evaluation({ room_rent_limit: "FAIL", sum_insured: "FAIL" }) }));
    expect(c.canSubmit).toBe(true);
    expect(c.hardFailures).toEqual([]);
    expect(c.warnings.map((i) => i.key)).toEqual(expect.arrayContaining(["room_eligibility", "sum_insured"]));
  });

  it("rule items absent from the policy are marked not applicable (e.g. no deductible)", () => {
    const item = computeChecklist(base()).items.find((i) => i.key === "deductible")!;
    expect(item.complete).toBe(true);
    expect(item.detail).toMatch(/Not part of this policy/);
  });
});
