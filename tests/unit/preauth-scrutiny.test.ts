import { describe, expect, it } from "vitest";
import { computePreauthChecklist } from "@/modules/preauth/preauth.checklist";
import { isNewborn, scrutinize, wizardDocuments, type MemberRecord } from "@/modules/preauth/preauth.scrutiny";
import { expectedCost, gapsAcknowledgment, stayDays, wizardClinicalSchema, wizardKycSchema } from "@/modules/preauth/preauth.validation";
import type { Evaluation, RuleResult } from "@/modules/rules/engine/types";

const result = (kind: string, outcome: RuleResult["outcome"], category: RuleResult["category"] = "eligibility"): RuleResult => ({
  code: kind, title: kind, category, kind, outcome, message: `${kind} ${outcome}`, missing: [], applicable: true,
});
const evaluation = (results: RuleResult[]): Evaluation => ({ overall: "PASS", results, missingInformation: [], requiredDocuments: [], preauthRequired: null, estimate: null });
const checklist = (ev: Evaluation | null, manual: Record<string, { confirmed: boolean }> = {}) =>
  computePreauthChecklist({ evaluation: ev, hasPolicy: true, hasDiagnosis: true, hasProcedure: true, hasEstimate: true, manual });
const base = { clinicalIssues: [], estimatedCost: 50000, availableBalance: 100000, today: "2026-10-08" };
const ALL_MANUAL = Object.fromEntries(["patient_identified", "details_match", "diagnosis_confirmed", "procedure_confirmed"].map((k) => [k, { confirmed: true }]));
const ALL_DOCS = ["id_proof", "insurance_card", "preauth_form", "doctor_consultation"];
const record: MemberRecord = { fullName: "Asha Rao", gender: "female", dob: "1980-01-01", memberId: "M-1", coverStart: "2026-04-01", coverEnd: "2027-03-31", sumInsured: 500000, policyHasTpa: true };
const kyc = { patientName: "Asha Rao", gender: "female", dob: "1980-01-01", mobile: "9000000000", policyNumber: "P-1", policyFrom: "2026-04-01", policyTo: "2027-03-31", sumInsured: 500000, memberId: "M-1" };

describe("wizardDocuments", () => {
  it("lists the papers with the tiers of the standard cashless case", () => {
    const d = wizardDocuments(null, []);
    expect(d.map((x) => [x.type, x.tier])).toEqual([
      ["id_proof", "expected"],
      ["insurance_card", "expected"],
      ["preauth_form", "must"],
      ["doctor_consultation", "expected"],
      ["medical_history", "optional"],
    ]);
    expect(d.find((x) => x.type === "preauth_form")?.printable).toBe(true);
  });

  it("a row is satisfied by any accepted type; policy rules only raise tiers; newborns add papers", () => {
    const d = wizardDocuments(
      [
        { type: "medical_history", label: "Past history", mandatory: true },
        { type: "investigation_reports", label: "Reports", mandatory: true },
        { type: "ecg", label: "ECG", mandatory: false },
      ],
      ["policy_copy", "investigation_reports"],
      { newborn: true },
    );
    expect(d.find((x) => x.type === "insurance_card")).toMatchObject({ uploaded: 1 });
    // The doctor's-note row is satisfied by the reports, but a rule asking for the reports gets its own MUST row.
    expect(d.find((x) => x.type === "doctor_consultation")).toMatchObject({ tier: "expected", uploaded: 1, source: "standard" });
    expect(d.find((x) => x.type === "investigation_reports")).toMatchObject({ tier: "must", uploaded: 1, source: "policy_rules" });
    expect(d.find((x) => x.type === "medical_history")?.tier).toBe("must");
    expect(d.find((x) => x.type === "ecg")?.tier).toBe("expected");
    expect(d.map((x) => x.type)).toEqual(expect.arrayContaining(["birth_certificate", "endorsement_letter"]));
  });
});

describe("scrutinize", () => {
  it("missing information is reported, never a pass; only incomplete case details block", () => {
    const s = scrutinize({ ...base, evaluated: false, clinicalIssues: [{ field: "doctorName", message: "Enter the treating doctor's name." }], documents: wizardDocuments(null, []), checklist: checklist(null) });
    const keys = s.findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["not_evaluated", "clinical:doctorName", "document:preauth_form", "document:id_proof"]));
    expect(s.findings.find((f) => f.key === "document:preauth_form")?.severity).toBe("critical");
    expect(s.findings.find((f) => f.key === "document:id_proof")?.severity).toBe("medium");
    expect(s.blocking).toBe(1);
    expect(s.refuse + s.query).toBe(s.findings.length);
  });

  it("compares the typed KYC with the policy record", () => {
    const s = scrutinize({
      ...base, evaluated: true, documents: wizardDocuments(null, ALL_DOCS), checklist: checklist(evaluation([]), ALL_MANUAL), record,
      kyc: { ...kyc, patientName: "Asha R", policyFrom: "2025-04-01", memberId: undefined, sumInsured: 300000 },
    });
    const by = Object.fromEntries(s.findings.map((f) => [f.key, f.severity]));
    expect(by).toMatchObject({ "kyc:name": "high", "kyc:dates": "medium", "kyc:tpa_card": "medium", "kyc:sum": "low" });
    expect(s.findings.find((f) => f.key === "kyc:dates")?.title).toMatch(/Date mismatch/);
  });

  it("newborns: coverage constraints, and ROP screening for retinopathy of prematurity", () => {
    const baby = { ...record, dob: "2026-09-20" };
    const s = scrutinize({
      ...base, evaluated: true, documents: wizardDocuments(null, ALL_DOCS, { newborn: true }), checklist: checklist(evaluation([]), ALL_MANUAL), record: baby,
      kyc: { ...kyc, dob: baby.dob }, admissionDate: "2026-10-10", diagnosisCodes: ["H35.10"],
    });
    const keys = s.findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["newborn", "newborn:rop", "document:birth_certificate", "document:endorsement_letter"]));
    expect(isNewborn("2026-09-20", "2026-10-10")).toBe(true);
    expect(isNewborn("2026-01-01", "2026-10-10")).toBe(false);
  });

  it("rules needing verification are confirmable with a note; sum insured and admission outside cover are flagged", () => {
    const ev = evaluation([result("hospital_network", "NEEDS_VERIFICATION"), result("x", "FAIL", "exclusion")]);
    const s = scrutinize({ ...base, evaluated: true, documents: wizardDocuments(null, ALL_DOCS), checklist: checklist(ev, ALL_MANUAL), estimatedCost: 900000, record, kyc, admissionDate: "2027-05-01" });
    expect(s.findings.find((f) => f.key === "check:hospital_network")).toMatchObject({ confirmItem: "hospital_network", needsNote: true });
    expect(s.findings.find((f) => f.key === "check:exclusions")?.severity).toBe("high");
    expect(s.findings.find((f) => f.key === "sum_insured")?.title).toBe("Sum insured may be insufficient");
    expect(s.findings.map((f) => f.key)).toContain("cover:admission_outside");
  });

  it("is clean when everything is complete and matches", () => {
    const s = scrutinize({ ...base, evaluated: true, documents: wizardDocuments(null, ALL_DOCS), checklist: checklist(evaluation([]), ALL_MANUAL), record, kyc, admissionType: "planned", admissionDate: "2026-10-20" });
    expect(s.findings).toEqual([]);
    expect(s).toMatchObject({ blocking: 0, refuse: 0, query: 0 });
  });
});

describe("New Claim helpers", () => {
  it("stay length counts part days and needs the end after the start", () => {
    expect(stayDays("2026-10-20", "09:00", "2026-10-23", "11:00")).toBe(4);
    expect(stayDays("2026-10-20", "09:00", "2026-10-20", "18:00")).toBe(1);
    expect(stayDays("2026-10-20", undefined, "2026-10-19", undefined)).toBeNull();
    expect(stayDays("2026-10-20")).toBeNull();
  });

  it("expected cost is the package amount when given, otherwise per day × days", () => {
    expect(expectedCost([{ perDay: 4000, days: 3 }, { perDay: 60000, days: 1 }], undefined)).toBe(72000);
    expect(expectedCost([{ perDay: 4000, days: 3 }], 50000)).toBe(50000);
    expect(expectedCost([], "")).toBeNull();
  });

  it("validates the KYC and the package step", () => {
    expect(wizardKycSchema.safeParse({ patientName: "A", gender: "male", dob: "1990-01-01", mobile: "123", insurerId: "x", policyNumber: "", policyFrom: "2026-04-01", policyTo: "2026-01-01" }).success).toBe(false);
    const r = wizardClinicalSchema.safeParse({ claimType: "cashless", chronicIllness: ["None", "Diabetes"] });
    expect(r.success).toBe(false);
    const fields = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["diagnosisIds", "symptoms", "admissionDate", "dischargeDate", "doctorName", "doctorContact", "chronicIllness", "costItems"]));
    expect(gapsAcknowledgment(3)).toBe("I have seen these 3 gaps and am sending anyway. This is written to the case audit trail with the submission.");
  });
});
