import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { beneficiaries, diagnoses, packages, policies, procedures, rules, ruleSets, ruleVersions } from "@/db/schema";
import { documentLabel } from "@/modules/documents/document-types";
import { parseRuleConfig } from "@/modules/rules/engine/kinds";
import type { RuleCategory } from "@/modules/rules/engine/types";
import { DEMO } from "./ids";

/**
 * DEMO DATA policies. Every insurer, product and rule value below is fictional and
 * for demonstration only — it is not any real insurer's or scheme's terms.
 */
export const DIAGNOSES = [
  ["I21", "Acute myocardial infarction"], ["K80", "Cholelithiasis (gallstones)"], ["H25", "Age-related cataract"],
  ["M17", "Osteoarthritis of knee"], ["N18", "Chronic kidney disease"], ["O80", "Single spontaneous delivery"],
  ["J18", "Pneumonia, unspecified organism"], ["S72", "Fracture of femur"], ["K35", "Acute appendicitis"],
  ["K40", "Inguinal hernia"], ["E66", "Obesity"], ["Z41.1", "Cosmetic surgery for unacceptable appearance"],
] as const;

export const PROCEDURES = [
  ["PTCA", "Coronary angioplasty (PTCA) with stent"], ["LAP-CHOLE", "Laparoscopic cholecystectomy"],
  ["CATARACT-PHACO", "Cataract surgery (phacoemulsification) with IOL"], ["TKR", "Total knee replacement"],
  ["HEMODIALYSIS", "Haemodialysis (per session)"], ["NORMAL-DELIVERY", "Normal delivery"], ["LSCS", "Caesarean section"],
  ["APPENDECTOMY", "Appendectomy"], ["HERNIA-REPAIR", "Hernia repair (mesh)"], ["ORIF-FEMUR", "Open reduction internal fixation, femur"],
  ["PNEUMONIA-MGMT", "Medical management of pneumonia"], ["BARIATRIC", "Bariatric (weight-loss) surgery"], ["RHINOPLASTY", "Cosmetic rhinoplasty"],
] as const;

type R = { category: RuleCategory; code: string; title: string; config: Record<string, unknown> };
const r = (category: RuleCategory, code: string, title: string, config: Record<string, unknown>): R => ({ category, code, title, config });
const docs = (stage: "preauth" | "claim", types: [string, boolean][]) => ({
  kind: "required_documents",
  stage,
  documents: types.map(([type, mandatory]) => ({ type, label: documentLabel(type), mandatory })),
});

const PRIVATE_PREAUTH_DOCS = docs("preauth", [["id_proof", true], ["insurance_card", true], ["doctor_consultation", true], ["investigation_reports", true], ["treatment_estimate", true], ["medical_history", false]]);
const PRIVATE_CLAIM_DOCS = docs("claim", [["final_bill", true], ["discharge_summary", true], ["investigation_reports", true], ["pharmacy_bills", true], ["operation_notes", false], ["implant_invoice", false], ["payment_receipts", false]]);
const SCHEME_PREAUTH_DOCS = docs("preauth", [["beneficiary_id", true], ["id_proof", true], ["clinical_notes", true], ["investigation_reports", true]]);
const SCHEME_CLAIM_DOCS = docs("claim", [["discharge_summary", true], ["final_bill", true], ["investigation_reports", true], ["operation_notes", false]]);

const COMMON_WAITING = [
  r("waiting_period", "initial_30_days", "Initial 30-day waiting period", { kind: "initial_waiting", days: 30, exceptAccident: true }),
  r("waiting_period", "cataract_2y", "Cataract: 2-year waiting period", { kind: "specific_waiting", label: "Cataract", days: 730, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] }),
  r("waiting_period", "joint_replacement_2y", "Joint replacement: 2-year waiting period", { kind: "specific_waiting", label: "Joint replacement", days: 730, diagnosisCodes: ["M17"], procedureCodes: ["TKR"] }),
  r("waiting_period", "hernia_2y", "Hernia: 2-year waiting period", { kind: "specific_waiting", label: "Hernia", days: 730, diagnosisCodes: ["K40"], procedureCodes: ["HERNIA-REPAIR"] }),
];
const COMMON_EXCLUSIONS = [
  r("exclusion", "cosmetic", "Cosmetic treatment", { kind: "excluded_diagnoses", codes: ["Z41.1"], reason: "Cosmetic or aesthetic treatment" }),
  r("exclusion", "cosmetic_procedures", "Cosmetic procedures", { kind: "excluded_procedures", codes: ["RHINOPLASTY"], reason: "Cosmetic surgery" }),
  r("exclusion", "obesity", "Weight-loss treatment", { kind: "excluded_procedures", codes: ["BARIATRIC"], reason: "Obesity / weight-loss surgery" }),
];
const ALL_PRIVATE_PROCS = ["PTCA", "LAP-CHOLE", "CATARACT-PHACO", "TKR", "HEMODIALYSIS", "APPENDECTOMY", "HERNIA-REPAIR", "ORIF-FEMUR", "PNEUMONIA-MGMT", "LSCS", "NORMAL-DELIVERY"];

interface PolicyDef {
  id: string;
  category: "private" | "government";
  insurerId?: string;
  tpaId?: string;
  schemeId?: string;
  name: string;
  productType: string;
  si: [number, number];
  summary: string;
  info: Record<string, string>;
  rules: R[];
  packages?: [code: string, name: string, procedure: string, rate: number][];
}

const PRIVATE_INFO = (insurer: string) => ({
  cashless: "At a network hospital, the hospital's insurance desk sends a pre-authorization request to the insurer/TPA before admission (or within 24 hours of an emergency admission). The approved amount is settled directly with the hospital; non-payable items, co-pay, deductibles and amounts above limits are paid by the patient at discharge.",
  reimbursement: "The patient pays the hospital and submits the claim with original bills and reports within the deadline. The admissible amount is reimbursed as per policy terms.",
  preauthProcess: "Submit the pre-authorization form with ID, insurance card, doctor's notes, investigation reports and a cost estimate. Queries must be answered promptly; the approval is an initial estimate and not the final settlement.",
  claimProcess: "After discharge, submit the final bill, discharge summary, reports and pharmacy bills. The final admissible amount may differ from the pre-authorized amount.",
  renewal: "Renew before the expiry date to keep continuity benefits (waiting periods already served). A 30-day grace period may apply; claims during a break in cover are not payable.",
  contact: `${insurer} claims desk (DEMO DATA): see the insurer page for helpline details.`,
});

export const POLICY_DEFS: PolicyDef[] = [
  {
    id: DEMO.policy.aarogyaFloater,
    category: "private",
    insurerId: DEMO.org.insurerA,
    tpaId: DEMO.org.tpaA,
    name: "Aarogya Family Floater Plus (DEMO DATA)",
    productType: "family_floater",
    si: [300000, 1500000],
    summary: "Fictional family floater covering self, spouse, children and parents on a shared sum insured.",
    info: { ...PRIVATE_INFO("Aarogya Shield"), eligibilityNotes: "Members aged up to 65 at entry. Dependent children up to 25." },
    rules: [
      r("eligibility", "cover_active", "Policy active on admission", { kind: "cover_active" }),
      r("eligibility", "age_limit", "Member age up to 65", { kind: "age_range", minAge: 0, maxAge: 65 }),
      r("eligibility", "members", "Covered family members", { kind: "relationship_allowed", allowed: ["self", "spouse", "child", "parent"] }),
      r("eligibility", "network", "Network hospital for cashless", { kind: "hospital_network", reimbursementAtNonNetwork: true, staleAfterDays: 180 }),
      r("coverage", "covered_procedures", "Listed covered treatments", { kind: "procedure_coverage", covered: ALL_PRIVATE_PROCS, unlisted: "needs_verification" }),
      ...COMMON_WAITING,
      r("ped", "ped_3y", "Pre-existing diseases after 3 years", { kind: "ped_waiting", days: 1095 }),
      ...COMMON_EXCLUSIONS,
      r("limit", "sum_insured", "Available sum insured", { kind: "sum_insured" }),
      r("limit", "room_rent", "Room rent up to 1% of sum insured", { kind: "room_rent_limit", basis: "percent_of_sum_insured", value: 1, proportionateDeduction: true }),
      r("limit", "cataract_cap", "Cataract sub-limit", { kind: "sub_limit", label: "Cataract (per eye)", maxAmount: 40000, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] }),
      r("limit", "senior_copay", "20% co-pay from age 60", { kind: "co_pay", percent: 20, minAge: 60 }),
      r("document", "preauth_docs", "Pre-authorization documents", PRIVATE_PREAUTH_DOCS),
      r("document", "claim_docs", "Final claim documents", PRIVATE_CLAIM_DOCS),
      r("preauth", "preauth_cashless", "Pre-authorization for cashless", { kind: "preauth_required", claimTypes: ["cashless"] }),
      r("claim", "submission_30d", "Submit within 30 days of discharge", { kind: "claim_submission_window", daysAfterDischarge: 30 }),
    ],
  },
  {
    id: DEMO.policy.surakshaIndividual,
    category: "private",
    insurerId: DEMO.org.insurerB,
    name: "Suraksha Individual Health Secure (DEMO DATA)",
    productType: "individual",
    si: [200000, 1000000],
    summary: "Fictional individual policy with a flat room-rent cap and 10% co-pay on every claim.",
    info: { ...PRIVATE_INFO("Suraksha Health"), eligibilityNotes: "Adults aged 18 to 75." },
    rules: [
      r("eligibility", "cover_active", "Policy active on admission", { kind: "cover_active" }),
      r("eligibility", "age_limit", "Adults 18–75", { kind: "age_range", minAge: 18, maxAge: 75 }),
      r("eligibility", "members", "Policyholder only", { kind: "relationship_allowed", allowed: ["self"] }),
      r("eligibility", "network", "Network required (no non-network claims)", { kind: "hospital_network", reimbursementAtNonNetwork: false, staleAfterDays: 180 }),
      r("coverage", "covered_procedures", "Listed covered treatments", { kind: "procedure_coverage", covered: ["PTCA", "LAP-CHOLE", "CATARACT-PHACO", "APPENDECTOMY", "HERNIA-REPAIR", "ORIF-FEMUR", "PNEUMONIA-MGMT"], unlisted: "fail" }),
      r("waiting_period", "initial_30_days", "Initial 30-day waiting period", { kind: "initial_waiting", days: 30, exceptAccident: true }),
      r("waiting_period", "cataract_1y", "Cataract: 1-year waiting period", { kind: "specific_waiting", label: "Cataract", days: 365, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] }),
      r("ped", "ped_2y", "Pre-existing diseases after 2 years", { kind: "ped_waiting", days: 730 }),
      ...COMMON_EXCLUSIONS,
      r("limit", "sum_insured", "Available sum insured", { kind: "sum_insured" }),
      r("limit", "room_rent", "Room rent up to ₹5,000/day", { kind: "room_rent_limit", basis: "fixed_per_day", value: 5000, proportionateDeduction: false }),
      r("limit", "copay_10", "10% co-pay on all claims", { kind: "co_pay", percent: 10 }),
      r("document", "preauth_docs", "Pre-authorization documents", PRIVATE_PREAUTH_DOCS),
      r("document", "claim_docs", "Final claim documents", PRIVATE_CLAIM_DOCS),
      r("preauth", "preauth_cashless", "Pre-authorization for cashless", { kind: "preauth_required", claimTypes: ["cashless"] }),
      r("claim", "submission_15d", "Submit within 15 days of discharge", { kind: "claim_submission_window", daysAfterDischarge: 15 }),
    ],
  },
  {
    id: DEMO.policy.navjeevanTopUp,
    category: "private",
    insurerId: DEMO.org.insurerC,
    tpaId: DEMO.org.tpaB,
    name: "Navjeevan Super Top-Up 10L (DEMO DATA)",
    productType: "super_top_up",
    si: [1000000, 1000000],
    summary: "Fictional super top-up: pays admissible expenses above a ₹3 lakh deductible.",
    info: { ...PRIVATE_INFO("Navjeevan General"), eligibilityNotes: "Adults 18–65. The deductible can be met by a base policy or paid by the patient." },
    rules: [
      r("eligibility", "cover_active", "Policy active on admission", { kind: "cover_active" }),
      r("eligibility", "age_limit", "Adults 18–65", { kind: "age_range", minAge: 18, maxAge: 65 }),
      r("eligibility", "members", "Self and spouse", { kind: "relationship_allowed", allowed: ["self", "spouse"] }),
      r("eligibility", "network", "Network hospital for cashless", { kind: "hospital_network", reimbursementAtNonNetwork: true, staleAfterDays: 180 }),
      r("coverage", "covered_procedures", "Listed covered treatments", { kind: "procedure_coverage", covered: ALL_PRIVATE_PROCS, unlisted: "needs_verification" }),
      r("waiting_period", "initial_30_days", "Initial 30-day waiting period", { kind: "initial_waiting", days: 30, exceptAccident: true }),
      r("ped", "ped_3y", "Pre-existing diseases after 3 years", { kind: "ped_waiting", days: 1095 }),
      ...COMMON_EXCLUSIONS,
      r("limit", "sum_insured", "Available sum insured", { kind: "sum_insured" }),
      r("limit", "deductible", "₹3,00,000 aggregate deductible", { kind: "deductible", amount: 300000 }),
      r("limit", "room_rent", "Room rent up to 1% of sum insured", { kind: "room_rent_limit", basis: "percent_of_sum_insured", value: 1, proportionateDeduction: true }),
      r("document", "preauth_docs", "Pre-authorization documents", PRIVATE_PREAUTH_DOCS),
      r("document", "claim_docs", "Final claim documents", PRIVATE_CLAIM_DOCS),
      r("preauth", "preauth_cashless", "Pre-authorization for cashless", { kind: "preauth_required", claimTypes: ["cashless"] }),
    ],
  },
  {
    id: DEMO.policy.aarogyaSenior,
    category: "private",
    insurerId: DEMO.org.insurerA,
    tpaId: DEMO.org.tpaA,
    name: "Aarogya Senior Citizen Care (DEMO DATA)",
    productType: "senior_citizen",
    si: [200000, 500000],
    summary: "Fictional senior citizen policy with a 30% co-pay and shorter PED waiting period.",
    info: { ...PRIVATE_INFO("Aarogya Shield"), eligibilityNotes: "Entry age 60–80." },
    rules: [
      r("eligibility", "cover_active", "Policy active on admission", { kind: "cover_active" }),
      r("eligibility", "age_limit", "Age 60–85", { kind: "age_range", minAge: 60, maxAge: 85 }),
      r("eligibility", "members", "Self and spouse", { kind: "relationship_allowed", allowed: ["self", "spouse"] }),
      r("eligibility", "network", "Network hospital for cashless", { kind: "hospital_network", reimbursementAtNonNetwork: true, staleAfterDays: 180 }),
      r("coverage", "covered_procedures", "Listed covered treatments", { kind: "procedure_coverage", covered: ["PTCA", "CATARACT-PHACO", "TKR", "HEMODIALYSIS", "PNEUMONIA-MGMT", "ORIF-FEMUR", "HERNIA-REPAIR"], unlisted: "needs_verification" }),
      ...COMMON_WAITING,
      r("ped", "ped_1y", "Pre-existing diseases after 1 year", { kind: "ped_waiting", days: 365 }),
      ...COMMON_EXCLUSIONS,
      r("limit", "sum_insured", "Available sum insured", { kind: "sum_insured" }),
      r("limit", "room_rent", "Room rent up to ₹4,000/day", { kind: "room_rent_limit", basis: "fixed_per_day", value: 4000, proportionateDeduction: true }),
      r("limit", "copay_30", "30% co-pay on all claims", { kind: "co_pay", percent: 30 }),
      r("limit", "cataract_cap", "Cataract sub-limit", { kind: "sub_limit", label: "Cataract (per eye)", maxAmount: 30000, diagnosisCodes: ["H25"], procedureCodes: ["CATARACT-PHACO"] }),
      r("document", "preauth_docs", "Pre-authorization documents", PRIVATE_PREAUTH_DOCS),
      r("document", "claim_docs", "Final claim documents", PRIVATE_CLAIM_DOCS),
      r("preauth", "preauth_cashless", "Pre-authorization for cashless", { kind: "preauth_required", claimTypes: ["cashless"] }),
    ],
  },
  ...(["pmjay", "cghs", "state"] as const).map((s): PolicyDef => ({
    id: DEMO.policy[`${s}Scheme`],
    category: "government",
    schemeId: DEMO.scheme[s],
    name: { pmjay: "PM-JAY family health cover", cghs: "CGHS inpatient benefit", state: "Demo State scheme cover" }[s] + " (DEMO DATA)",
    productType: s === "cghs" ? "employee_scheme" : s === "pmjay" ? "central_scheme" : "state_scheme",
    si: s === "pmjay" ? [500000, 500000] : s === "state" ? [200000, 200000] : [0, 0],
    summary: "DEMO DATA representation for workflow demonstration only. Not official scheme rules — verify every case with the scheme.",
    info: {
      beneficiaryVerification: "Verify the beneficiary against the scheme's own beneficiary identification system before admission. An insurance card alone is not proof of scheme eligibility.",
      eligibilityNotes: "Eligibility is decided by the scheme, not by the hospital. Record the beneficiary ID exactly.",
      packageRules: "Treatment is paid as fixed packages at scheme rates. Items outside the package are generally not payable by the scheme.",
      preauthProcess: "Raise pre-authorization through the scheme's process with the beneficiary ID, clinical notes and reports.",
      claimProcess: "Submit the claim with the discharge summary and required documents after discharge, per the scheme's timelines.",
      patientResponsibilities: "Carry the beneficiary ID and a photo ID. Report any charges requested outside the package to the scheme.",
      contact: "Contact the scheme's helpline or the hospital's scheme desk (DEMO DATA).",
    },
    rules: [
      r("eligibility", "cover_active", "Beneficiary enrolment active", { kind: "cover_active" }),
      r("eligibility", "empanelment", "Empanelled hospital only", { kind: "hospital_network", reimbursementAtNonNetwork: false, staleAfterDays: 365 }),
      r("coverage", "packages", "Treatments covered as packages", { kind: "procedure_coverage", covered: ["PTCA", "LAP-CHOLE", "CATARACT-PHACO", "TKR", "HEMODIALYSIS", "NORMAL-DELIVERY", "LSCS", "APPENDECTOMY", "HERNIA-REPAIR", "ORIF-FEMUR", "PNEUMONIA-MGMT"], unlisted: "needs_verification" }),
      r("waiting_period", "no_waiting", "No initial waiting period", { kind: "initial_waiting", days: 0, exceptAccident: false }),
      r("ped", "ped_day_one", "Pre-existing conditions covered from day one", { kind: "ped_waiting", days: 0 }),
      r("exclusion", "cosmetic", "Cosmetic treatment", { kind: "excluded_diagnoses", codes: ["Z41.1"], reason: "Cosmetic treatment" }),
      r("limit", "sum_insured", "Available family entitlement", { kind: "sum_insured" }),
      r("document", "preauth_docs", "Pre-authorization documents", SCHEME_PREAUTH_DOCS),
      r("document", "claim_docs", "Claim documents", SCHEME_CLAIM_DOCS),
      r("preauth", "preauth_all", "Pre-authorization for all planned admissions", { kind: "preauth_required", claimTypes: ["cashless", "reimbursement"] }),
    ],
    packages: [
      ["DEMO-PKG-CARD-01", "Coronary angioplasty package", "PTCA", 120000],
      ["DEMO-PKG-OPH-01", "Cataract package (per eye)", "CATARACT-PHACO", 15000],
      ["DEMO-PKG-ORTHO-01", "Total knee replacement package", "TKR", 90000],
      ["DEMO-PKG-GS-01", "Laparoscopic cholecystectomy package", "LAP-CHOLE", 30000],
      ["DEMO-PKG-OBG-01", "Caesarean delivery package", "LSCS", 12000],
    ],
  })),
];

export async function seedPolicies(db: DbOrTx, opts: { resetDemoBalances?: boolean } = {}) {
  await db.insert(diagnoses).values(DIAGNOSES.map(([code, name]) => ({ code, name, isDemo: true }))).onConflictDoNothing();
  await db.insert(procedures).values(PROCEDURES.map(([code, name]) => ({ code, name, isDemo: true }))).onConflictDoNothing();
  const procId = new Map((await db.select({ id: procedures.id, code: procedures.code }).from(procedures)).map((p) => [p.code, p.id]));

  for (const p of POLICY_DEFS) {
    await db
      .insert(policies)
      .values({
        id: p.id,
        category: p.category,
        insurerId: p.insurerId ?? null,
        tpaId: p.tpaId ?? null,
        schemeId: p.schemeId ?? null,
        name: p.name,
        productType: p.productType,
        sumInsuredMin: p.si[0] ? p.si[0].toFixed(2) : null,
        sumInsuredMax: p.si[1] ? p.si[1].toFixed(2) : null,
        summary: p.summary,
        info: p.info,
        isDemo: true,
      })
      .onConflictDoNothing();

    for (const rr of p.rules) {
      const v = parseRuleConfig(rr.config);
      if (!v.ok) throw new Error(`Seed rule ${p.name}/${rr.code} invalid: ${v.error}`);
    }

    await db.insert(ruleSets).values({ policyId: p.id, name: "Standard" }).onConflictDoNothing();
    const [set] = await db.select().from(ruleSets).where(and(eq(ruleSets.policyId, p.id), eq(ruleSets.name, "Standard")));
    const [existing] = await db.select({ id: ruleVersions.id }).from(ruleVersions).where(eq(ruleVersions.ruleSetId, set!.id)).limit(1);
    if (!existing) {
      // Build as draft (the only state that accepts rules), then publish.
      const [v] = await db.insert(ruleVersions).values({ ruleSetId: set!.id, version: 1, status: "draft" }).returning();
      await db.insert(rules).values(p.rules.map((x, i) => ({ ruleVersionId: v!.id, category: x.category, code: x.code, title: x.title, config: x.config, sortOrder: i })));
      await db.update(ruleVersions).set({ status: "active", effectiveFrom: "2026-01-01" }).where(eq(ruleVersions.id, v!.id));
    }

    if (p.packages?.length) {
      const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(packages).where(eq(packages.policyId, p.id));
      if (!has?.n) {
        await db.insert(packages).values(p.packages.map(([code, name, proc, rate]) => ({ policyId: p.id, schemeId: p.schemeId ?? null, procedureId: procId.get(proc) ?? null, code, name, rate: rate.toFixed(2), isDemo: true })));
      }
    }
  }

  const ben = (id: string, patientId: string, policyId: string, category: "private" | "government", memberId: string, relationship: string, start: string, end: string, inception: string, si: number, bal: number, schemeId?: string) => ({
    id, patientId, policyId, category, schemeId: schemeId ?? null, memberId, relationship, coverStart: start, coverEnd: end, inceptionDate: inception, sumInsured: si.toFixed(2), sumInsuredAvailable: bal.toFixed(2), isDemo: true,
  });
  const demoCover = [
    // Long-standing floater: waiting periods served.
      ben(DEMO.beneficiary.a1Floater, DEMO.patient.a1, DEMO.policy.aarogyaFloater, "private", "DEMO-AAR-FF-0001", "self", "2026-04-01", "2027-03-31", "2021-04-01", 500000, 450000),
      // Brand-new individual policy: initial and specific waiting periods still running.
      ben(DEMO.beneficiary.a2Individual, DEMO.patient.a2, DEMO.policy.surakshaIndividual, "private", "DEMO-SUR-IND-0002", "self", "2026-09-15", "2027-09-14", "2026-09-15", 300000, 300000),
      // Expired senior policy and an active CGHS enrolment for the older patient.
      ben(DEMO.beneficiary.b1Senior, DEMO.patient.b1, DEMO.policy.aarogyaSenior, "private", "DEMO-AAR-SC-0003", "self", "2025-09-01", "2026-08-31", "2023-09-01", 300000, 300000),
      ben(DEMO.beneficiary.b1Cghs, DEMO.patient.b1, DEMO.policy.cghsScheme, "government", "DEMO-CGHS-0004", "self", "2020-01-01", "2030-12-31", "2020-01-01", 1000000, 1000000, DEMO.scheme.cghs),
  ];
  await db.insert(beneficiaries).values(demoCover).onConflictDoNothing();

  // Test databases only: settlements in earlier runs reduce balances; restore the demo values.
  if (opts.resetDemoBalances) {
    for (const b of demoCover) {
      await db.update(beneficiaries).set({ sumInsuredAvailable: b.sumInsuredAvailable }).where(eq(beneficiaries.id, b.id));
    }
  }
}
