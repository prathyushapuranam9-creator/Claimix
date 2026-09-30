import { describe, expect, it } from "vitest";
import { answer, decisionSequence, type AssistantContext } from "@/modules/assistant/answer";
import { classify, INTENTS, type Intent } from "@/modules/assistant/intents";
import type { Evaluation, RuleResult } from "@/modules/rules/engine/types";

const r = (kind: string, category: RuleResult["category"], outcome: RuleResult["outcome"] = "PASS", extra: Partial<RuleResult> = {}): RuleResult => ({
  code: kind, title: kind, kind, category, outcome, message: `${kind} ${outcome}`, missing: outcome === "NEEDS_VERIFICATION" ? [`info for ${kind}`] : [], applicable: true, ...extra,
});

function evaluation(over: Record<string, RuleResult["outcome"]> = {}): Evaluation {
  const o = (k: string) => over[k] ?? "PASS";
  return {
    overall: "PASS",
    results: [
      r("cover_active", "eligibility", o("cover_active")),
      r("age_range", "eligibility", o("age_range")),
      r("hospital_network", "eligibility", o("hospital_network")),
      r("procedure_coverage", "coverage", o("procedure_coverage")),
      r("initial_waiting", "waiting_period", o("initial_waiting")),
      r("ped_waiting", "ped", o("ped_waiting")),
      r("excluded_diagnoses", "exclusion", o("excluded_diagnoses")),
      r("sum_insured", "limit", o("sum_insured")),
      r("required_documents", "document", o("required_documents"), { data: { documents: [{ type: "id_proof", label: "Photo ID proof", mandatory: true, stage: "preauth" }, { type: "insurance_card", label: "Insurance card", mandatory: true, stage: "preauth" }] } }),
      r("preauth_required", "preauth", "PASS", { data: { preauthRequired: true } }),
    ],
    missingInformation: [],
    requiredDocuments: [
      { type: "id_proof", label: "Photo ID proof", mandatory: true, stage: "preauth" },
      { type: "insurance_card", label: "Insurance card", mandatory: true, stage: "preauth" },
    ],
    preauthRequired: true,
    estimate: null,
  };
}

function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  return {
    kind: "preauth", reference: "PA-1", status: "submitted", statusLabel: "Submitted", claimType: "cashless",
    policyName: "Demo Policy", category: "private", payerName: "Demo Insurer", evaluation: evaluation(), ruleVersion: 1,
    documents: [{ docType: "id_proof", status: "uploaded" }], openQueries: [], decisions: [], nextAction: "Review the request",
    ...over,
  };
}

const ALL = Object.keys(INTENTS) as Intent[];

describe("question classification", () => {
  it("each suggested question maps to its own topic", () => {
    for (const k of ALL) expect(classify(INTENTS[k]), k).toBe(k);
  });

  it("understands natural phrasings", () => {
    expect(classify("why did they reject this?")).toBe("why_rejected");
    expect(classify("which papers do we need")).toBe("documents_required");
    expect(classify("is the policy still valid")).toBe("policy_active");
    expect(classify("what's missing")).toBe("missing_documents");
    expect(classify("do we need pre-authorisation")).toBe("preauth_required");
  });

  it("returns nothing for unrelated questions", () => {
    expect(classify("what's the weather in Pune")).toBeNull();
    expect(classify("   ")).toBeNull();
  });
});

describe("answer safety", () => {
  const scenarios: [string, AssistantContext][] = [
    ["all pass", ctx()],
    ["no evaluation", ctx({ evaluation: null })],
    ["failed checks", ctx({ evaluation: evaluation({ cover_active: "FAIL", excluded_diagnoses: "FAIL" }) })],
    ["needs verification", ctx({ evaluation: evaluation({ hospital_network: "NEEDS_VERIFICATION" }) })],
    ["approved", ctx({ status: "approved", statusLabel: "Approved", decisions: [{ decision: "approved", reasonTitle: null, reasonMeaning: null, reasonCheck: null, reasonAction: null, remarks: null, amount: "50000", at: "2026-09-30" }] })],
  ];

  it("never promises approval or payment, in any answer", () => {
    for (const [name, c] of scenarios) {
      for (const i of [...ALL, null]) {
        const a = answer(i, "q", c);
        const text = [a.headline, ...a.facts.map((f) => f.text), ...a.nextSteps].join(" ").toLowerCase();
        expect(text, `${name}/${i}`).not.toMatch(/will be (approved|paid|covered)|guarantee(d)? (approval|payment)|is approved by the platform/);
      }
    }
  });

  it("rule-based answers state they are not a payer decision", () => {
    for (const i of ["policy_active", "patient_eligible", "hospital_eligible", "cashless_available"] as Intent[]) {
      const a = answer(i, "q", ctx());
      expect(a.facts.some((f) => f.source === "guidance" && /not a payer decision/.test(f.text)), i).toBe(true);
    }
  });

  it("a request with failed checks is NOT reported as rejected without a payer rejection", () => {
    const a = answer("why_rejected", "why rejected?", ctx({ evaluation: evaluation({ cover_active: "FAIL" }) }));
    expect(a.headline).toBe("This request has not been rejected.");
    // Even a 'rejected' status without a recorded payer rejection isn't explained as one.
    const b = answer("why_rejected", "why rejected?", ctx({ status: "rejected", statusLabel: "Rejected", decisions: [] }));
    expect(b.headline).toBe("This request has not been rejected.");
  });

  it("explains a recorded payer rejection, labelled as the payer's decision", () => {
    const a = answer("why_rejected", "why?", ctx({
      status: "rejected", statusLabel: "Rejected",
      decisions: [{ decision: "rejected", reasonTitle: "Policy exclusion", reasonMeaning: "Excluded condition", reasonCheck: "Exclusions list", reasonAction: "Explain to the patient", remarks: "Cosmetic procedure", amount: null, at: "2026-09-30" }],
    }));
    expect(a.headline).toContain("Policy exclusion");
    expect(a.facts.find((f) => f.text.includes("Cosmetic procedure"))?.source).toBe("payer");
    expect(a.nextSteps).toEqual(["Explain to the patient"]);
  });

  it("asks for information when checks haven't been run, instead of guessing", () => {
    for (const i of ["policy_active", "patient_eligible", "hospital_eligible", "documents_required", "what_to_check"] as Intent[]) {
      const a = answer(i, "q", ctx({ evaluation: null }));
      expect(a.status, i).toBe("needs_information");
      expect(a.askFor.length, i).toBeGreaterThan(0);
    }
  });

  it("missing information from the rules is asked for and offered for review", () => {
    const a = answer("hospital_eligible", "q", ctx({ evaluation: evaluation({ hospital_network: "NEEDS_VERIFICATION" }) }));
    expect(a.status).toBe("needs_information");
    expect(a.askFor).toEqual(["info for hospital_network"]);
    expect(a.reviewReason).toBeTruthy();
  });

  it("unmatched questions go to human review", () => {
    const a = answer(null, "can you approve this for me", ctx());
    expect(a.status).toBe("needs_human_review");
  });

  it("missing documents combine rule requirements, re-uploads and open queries", () => {
    const a = answer("missing_documents", "q", ctx({
      documents: [{ docType: "id_proof", status: "requires_reupload" }],
      openQueries: [{ reasonTitle: "Missing documents", reasonAction: null, message: "Send USG", requiredDocuments: ["Ultrasound"] }],
    }));
    const text = a.facts.map((f) => f.text).join(" | ");
    expect(text).toContain("Insurance card");
    expect(text).toContain("Photo ID proof");
    expect(text).toContain("Ultrasound");
  });
});

describe("decision sequence", () => {
  it("follows payer → eligibility → policy → hospital → treatment → waiting/PED/exclusion → limits → documents → authorization → claim", () => {
    expect(decisionSequence(ctx()).map((s) => s.key)).toEqual(["payer", "eligibility", "policy", "hospital", "treatment", "waiting", "limits", "documents", "authorization", "claim"]);
  });

  it("reflects failures and verification needs", () => {
    const s = decisionSequence(ctx({ evaluation: evaluation({ cover_active: "FAIL", hospital_network: "NEEDS_VERIFICATION" }) }));
    expect(s.find((x) => x.key === "policy")?.state).toBe("fail");
    expect(s.find((x) => x.key === "hospital")?.state).toBe("verify");
  });
});
