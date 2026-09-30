import { describe, expect, it } from "vitest";
import { combine, evaluate, REQUIRED_CATEGORIES } from "@/modules/rules/engine/engine";
import { codeMatches, FACT_LABEL, type FactKey } from "@/modules/rules/engine/facts";
import { describeRule, parseRuleConfig, RULE_KINDS, RULE_KIND_KEYS } from "@/modules/rules/engine/kinds";
import type { CaseFacts, RuleCategory, RuleInput } from "@/modules/rules/engine/types";

/** A case where every check passes. Tests remove or change one thing at a time. */
function goodFacts(over: Partial<CaseFacts> = {}): CaseFacts {
  return {
    stage: "preauth",
    asOf: "2026-09-30",
    claimType: "cashless",
    patient: { dob: "1980-01-01", relationship: "self" },
    cover: { start: "2026-01-01", end: "2026-12-31", inceptionDate: "2020-01-01", sumInsured: 500000, availableBalance: 500000 },
    admissionDate: "2026-10-05",
    dischargeDate: "2026-10-08",
    submissionDate: "2026-10-20",
    hospital: { networkStatus: "network", cashlessAvailable: true, lastVerifiedAt: "2026-09-01" },
    diagnosisCode: "K35.8",
    procedureCode: "APPENDECTOMY",
    isAccident: false,
    ped: { declared: false },
    estimatedCost: 100000,
    roomRentPerDay: 4000,
    uploadedDocuments: ["id_proof", "insurance_card", "doctor_notes"],
    ...over,
  };
}

const rule = (category: RuleCategory, config: Record<string, unknown>, code = String(config.kind)): RuleInput => ({ code, title: code, category, config });

/** A realistic full rule set (one rule per required category at least). */
function fullRuleSet(): RuleInput[] {
  return [
    rule("eligibility", { kind: "cover_active" }),
    rule("eligibility", { kind: "age_range", minAge: 0, maxAge: 65 }),
    rule("eligibility", { kind: "relationship_allowed", allowed: ["self", "spouse", "child"] }),
    rule("eligibility", { kind: "hospital_network", reimbursementAtNonNetwork: true, staleAfterDays: 180 }),
    rule("coverage", { kind: "procedure_coverage", covered: ["APPENDECTOMY", "CATARACT-PHACO", "TKR"], unlisted: "needs_verification" }),
    rule("waiting_period", { kind: "initial_waiting", days: 30, exceptAccident: true }),
    rule("waiting_period", { kind: "specific_waiting", label: "Cataract", days: 730, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] }),
    rule("ped", { kind: "ped_waiting", days: 1095 }),
    rule("exclusion", { kind: "excluded_diagnoses", codes: ["Z41.1"], reason: "Cosmetic treatment" }),
    rule("limit", { kind: "sum_insured" }),
    rule("limit", { kind: "room_rent_limit", basis: "percent_of_sum_insured", value: 1, proportionateDeduction: true }),
    rule("limit", { kind: "sub_limit", label: "Cataract", maxAmount: 40000, procedureCodes: ["CATARACT-PHACO"] }),
    rule("limit", { kind: "co_pay", percent: 20, minAge: 60 }),
    rule("document", { kind: "required_documents", stage: "preauth", documents: [{ type: "id_proof", label: "ID proof", mandatory: true }, { type: "insurance_card", label: "Insurance card", mandatory: true }, { type: "investigation", label: "Reports", mandatory: false }] }),
    rule("preauth", { kind: "preauth_required", claimTypes: ["cashless"] }),
  ];
}

const outcomeOf = (facts: CaseFacts, rules = fullRuleSet()) => evaluate(rules, facts);
const find = (facts: CaseFacts, kind: string) => outcomeOf(facts).results.find((r) => r.kind === kind)!;

describe("baseline", () => {
  it("a complete, compliant case passes every check", () => {
    const e = outcomeOf(goodFacts());
    expect(e.results.filter((r) => r.outcome !== "PASS")).toEqual([]);
    expect(e.overall).toBe("PASS");
    expect(e.missingInformation).toEqual([]);
    expect(e.preauthRequired).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(outcomeOf(goodFacts()))).toBe(JSON.stringify(outcomeOf(goodFacts())));
  });
});

describe("SECURITY INVARIANT: missing information can never produce PASS", () => {
  // Paths to delete each fact from goodFacts().
  const REMOVE: Record<FactKey, (f: CaseFacts) => void> = {
    dob: (f) => delete f.patient!.dob,
    relationship: (f) => delete f.patient!.relationship,
    coverStart: (f) => delete f.cover!.start,
    coverEnd: (f) => delete f.cover!.end,
    inception: (f) => { delete f.cover!.inceptionDate; delete f.cover!.start; },
    sumInsured: (f) => delete f.cover!.sumInsured,
    availableBalance: (f) => delete f.cover!.availableBalance,
    admissionDate: (f) => delete f.admissionDate,
    dischargeDate: (f) => delete f.dischargeDate,
    submissionDate: (f) => delete f.submissionDate,
    claimType: (f) => delete f.claimType,
    networkStatus: (f) => { f.hospital!.networkStatus = null; },
    diagnosisCode: (f) => delete f.diagnosisCode,
    procedureCode: (f) => delete f.procedureCode,
    isAccident: (f) => delete f.isAccident,
    pedDeclared: (f) => delete f.ped!.declared,
    pedRelated: (f) => delete f.ped!.related,
    estimatedCost: (f) => delete f.estimatedCost,
    roomRentPerDay: (f) => delete f.roomRentPerDay,
    uploadedDocuments: (f) => delete f.uploadedDocuments,
  };

  for (const kind of RULE_KIND_KEYS) {
    const def = RULE_KINDS[kind];
    for (const stage of ["eligibility", "preauth", "claim"] as const) {
      it(`${kind} @ ${stage}: removing any consulted fact never yields a (different) PASS`, () => {
        const r: RuleInput = { code: kind, title: kind, category: def.categories[0]!, config: { kind, ...(def.example as object) } };
        const full = evaluate([r], goodFacts({ stage })).results[0]!;
        for (const key of Object.keys(FACT_LABEL) as FactKey[]) {
          const f = structuredClone(goodFacts({ stage }));
          REMOVE[key](f);
          const res = evaluate([r], f).results[0]!;
          if (res.outcome === "PASS") {
            // Allowed only if the rule didn't depend on that fact (identical result).
            expect({ key, message: res.message, data: res.data }).toEqual({ key, message: full.message, data: full.data });
          }
        }
      });
    }
  }

  it("an evaluation with no facts at all is never PASS", () => {
    for (const stage of ["eligibility", "preauth", "claim"] as const) {
      expect(evaluate(fullRuleSet(), { stage, asOf: "2026-09-30" }).overall).not.toBe("PASS");
    }
  });

  it("a policy without rules for a required category needs verification", () => {
    for (const cat of REQUIRED_CATEGORIES.eligibility) {
      const e = evaluate(fullRuleSet().filter((r) => r.category !== cat), goodFacts({ stage: "eligibility" }));
      expect(e.overall, cat).toBe("NEEDS_VERIFICATION");
      expect(e.results.some((r) => r.kind === "system" && r.category === cat)).toBe(true);
    }
  });

  it("an empty rule set is never PASS", () => {
    expect(evaluate([], goodFacts()).overall).toBe("NEEDS_VERIFICATION");
    expect(combine([])).toBe("NEEDS_VERIFICATION");
  });

  it("misconfigured, unknown or mis-filed rules fail closed", () => {
    const bad = [
      rule("eligibility", { kind: "age_range", minAge: "old" }, "bad_config"),
      rule("eligibility", { kind: "made_up_kind" }, "unknown"),
      rule("coverage", { kind: "cover_active" }, "wrong_category"),
      rule("limit", { kind: "sum_insured", extra: 1 }, "extra_keys"),
    ];
    for (const b of bad) {
      const r = evaluate([b], goodFacts()).results.find((x) => x.code === b.code)!;
      expect(r.outcome, b.code).toBe("NEEDS_VERIFICATION");
    }
  });
});

describe("eligibility outcomes", () => {
  it("expired policy → FAIL", () => {
    expect(find(goodFacts({ admissionDate: "2027-01-15" }), "cover_active").outcome).toBe("FAIL");
    expect(outcomeOf(goodFacts({ admissionDate: "2027-01-15" })).overall).toBe("FAIL");
  });

  it("policy not yet started → FAIL", () => {
    expect(find(goodFacts({ cover: { ...goodFacts().cover, start: "2026-11-01" } }), "cover_active").outcome).toBe("FAIL");
  });

  it("age outside range → FAIL", () => {
    expect(find(goodFacts({ patient: { dob: "1950-01-01", relationship: "self" } }), "age_range").outcome).toBe("FAIL");
  });

  it("relationship not covered → FAIL", () => {
    expect(find(goodFacts({ patient: { dob: "1980-01-01", relationship: "sibling" } }), "relationship_allowed").outcome).toBe("FAIL");
  });

  it("hospital not in network (cashless) → FAIL; unverified → NEEDS_VERIFICATION; stale → NEEDS_VERIFICATION", () => {
    expect(find(goodFacts({ hospital: { networkStatus: "non_network" } }), "hospital_network").outcome).toBe("FAIL");
    expect(find(goodFacts({ hospital: { networkStatus: "suspended" } }), "hospital_network").outcome).toBe("FAIL");
    expect(find(goodFacts({ hospital: { networkStatus: "unverified" } }), "hospital_network").outcome).toBe("NEEDS_VERIFICATION");
    expect(find(goodFacts({ hospital: { networkStatus: "network", cashlessAvailable: true, lastVerifiedAt: "2025-01-01" } }), "hospital_network").outcome).toBe("NEEDS_VERIFICATION");
    expect(find(goodFacts({ hospital: { networkStatus: "network", cashlessAvailable: false, lastVerifiedAt: "2026-09-01" } }), "hospital_network").outcome).toBe("FAIL");
  });

  it("reimbursement at a non-network hospital is allowed when the policy says so", () => {
    expect(find(goodFacts({ claimType: "reimbursement", hospital: { networkStatus: "non_network" } }), "hospital_network").outcome).toBe("PASS");
  });
});

describe("coverage, waiting periods, PED, exclusions", () => {
  it("unlisted treatment → NEEDS_VERIFICATION (never assumed covered)", () => {
    expect(find(goodFacts({ procedureCode: "LIVER-TRANSPLANT" }), "procedure_coverage").outcome).toBe("NEEDS_VERIFICATION");
  });

  it("initial waiting period → FAIL, but accidents are exempt, and unknown accident status needs verification", () => {
    const recent = { cover: { start: "2026-09-20", end: "2027-09-19", sumInsured: 500000, availableBalance: 500000 } };
    expect(find(goodFacts({ ...recent, isAccident: false }), "initial_waiting").outcome).toBe("FAIL");
    expect(find(goodFacts({ ...recent, isAccident: true }), "initial_waiting").outcome).toBe("PASS");
    expect(find(goodFacts({ ...recent, isAccident: undefined }), "initial_waiting").outcome).toBe("NEEDS_VERIFICATION");
  });

  it("specific waiting period applies only to matching treatments", () => {
    const cataract = { diagnosisCode: "H25.1", procedureCode: "CATARACT-PHACO", cover: { ...goodFacts().cover, inceptionDate: "2026-01-01" } };
    expect(find(goodFacts(cataract), "specific_waiting").outcome).toBe("FAIL");
    expect(find(goodFacts(), "specific_waiting").applicable).toBe(false);
  });

  it("PED: related to a declared PED within the waiting period → FAIL; relation unknown → NEEDS_VERIFICATION", () => {
    const young = { cover: { ...goodFacts().cover, inceptionDate: "2025-06-01" } };
    expect(find(goodFacts({ ...young, ped: { declared: true, related: true } }), "ped_waiting").outcome).toBe("FAIL");
    expect(find(goodFacts({ ...young, ped: { declared: true } }), "ped_waiting").outcome).toBe("NEEDS_VERIFICATION");
    expect(find(goodFacts({ ...young, ped: { declared: true, related: false } }), "ped_waiting").outcome).toBe("PASS");
    expect(find(goodFacts({ ped: { declared: true, related: true } }), "ped_waiting").outcome).toBe("PASS"); // 2020 inception: served
  });

  it("excluded diagnosis → FAIL", () => {
    expect(find(goodFacts({ diagnosisCode: "Z41.1" }), "excluded_diagnoses").outcome).toBe("FAIL");
  });
});

describe("limits and money", () => {
  it("insufficient balance → FAIL with shortfall", () => {
    const r = find(goodFacts({ estimatedCost: 600000 }), "sum_insured");
    expect(r.outcome).toBe("FAIL");
    expect(r.data?.shortfall).toBe(100000);
  });

  it("room rent above 1% of SI → FAIL", () => {
    expect(find(goodFacts({ roomRentPerDay: 6000 }), "room_rent_limit").outcome).toBe("FAIL");
  });

  it("indicative estimate applies sub-limit, co-pay and balance — and is null when a limit can't be checked", () => {
    const f = goodFacts({ procedureCode: "CATARACT-PHACO", diagnosisCode: "H25.1", estimatedCost: 60000, patient: { dob: "1955-01-01", relationship: "self" } });
    const rules = fullRuleSet().map((r) => (r.config as { kind: string }).kind === "age_range" ? rule("eligibility", { kind: "age_range", minAge: 0, maxAge: 80 }) : r);
    const e = evaluate(rules, f);
    // 60,000: 20,000 above sub-limit; co-pay 20% of 40,000 = 8,000 → patient 28,000, payer 32,000.
    expect(e.estimate).toMatchObject({ estimatedCost: 60000, indicativePayerAmount: 32000, indicativePatientAmount: 28000 });
    expect(evaluate(rules, { ...f, roomRentPerDay: undefined }).estimate).toBeNull();
  });

  it("deductible (top-up) reduces the payer amount", () => {
    const rules = [...fullRuleSet(), rule("limit", { kind: "deductible", amount: 300000 })];
    expect(evaluate(rules, goodFacts({ estimatedCost: 450000 })).estimate).toMatchObject({ indicativePayerAmount: 150000, indicativePatientAmount: 300000 });
  });
});

describe("documents and stages", () => {
  it("lists required documents at eligibility stage", () => {
    const e = evaluate(fullRuleSet(), goodFacts({ stage: "eligibility", uploadedDocuments: undefined }));
    expect(e.requiredDocuments.map((d) => d.type)).toEqual(["id_proof", "insurance_card", "investigation"]);
  });

  it("missing mandatory upload at pre-auth → FAIL naming the document", () => {
    const r = find(goodFacts({ uploadedDocuments: ["id_proof"] }), "required_documents");
    expect(r.outcome).toBe("FAIL");
    expect(r.data?.missingDocuments).toEqual(["insurance_card"]);
  });
});

describe("helpers", () => {
  it("codeMatches uses ICD prefix semantics", () => {
    expect(codeMatches("H25.1", ["H25"])).toBe(true);
    expect(codeMatches("h25", ["H25"])).toBe(true);
    expect(codeMatches("Z41.10", ["Z41.1"])).toBe(true);
    expect(codeMatches("K801", ["K80"])).toBe(false);
    expect(codeMatches("K8", ["K80"])).toBe(false);
  });

  it("every kind's example config is valid and describable", () => {
    for (const k of RULE_KIND_KEYS) {
      const cfg = { kind: k, ...(RULE_KINDS[k].example as object) };
      expect(parseRuleConfig(cfg).ok, k).toBe(true);
      expect(describeRule(cfg), k).toBeTruthy();
    }
  });
});
