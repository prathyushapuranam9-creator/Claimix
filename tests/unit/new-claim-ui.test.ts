import { describe, expect, it } from "vitest";
import { isValidAadhaar, maskAadhaar } from "@/lib/india";
import { clampDate, formatDateTime, fromClock, parseDateTime, toClock } from "@/components/ui/DateTimePicker";
import { availableBalance, policyWarnings, verifyAgainstRecord, type PolicyFacts } from "@/modules/preauth/kyc-verification";
import { riskLevel } from "@/components/preauth/wizard/ChecksDashboard";
import { checklistStep, docCategory } from "@/modules/preauth/preauth.scrutiny";
import { wizardClinicalSchema } from "@/modules/preauth/preauth.validation";
import { patientInputSchema } from "@/modules/patients/patients.validation";
import { buildRegistrationPdf } from "@/modules/preauth/registration-pdf";

/** A valid Aadhaar for tests: 11 digits plus the Verhoeff check digit (computed, never a real person's number). */
export function testAadhaar(prefix = "23456789012"): string {
  for (let d = 0; d <= 9; d++) if (isValidAadhaar(`${prefix}${d}`)) return `${prefix}${d}`;
  throw new Error("no check digit");
}

describe("Aadhaar", () => {
  it("accepts 12 digits with a valid Verhoeff check digit, never starting with 0 or 1", () => {
    const a = testAadhaar();
    expect(isValidAadhaar(a)).toBe(true);
    expect(isValidAadhaar(`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`)).toBe(true);
    expect(isValidAadhaar(a.slice(0, 11) + ((Number(a[11]) + 1) % 10))).toBe(false);
    expect(isValidAadhaar("123456789012")).toBe(false);
    expect(isValidAadhaar("2345678901")).toBe(false);
    expect(maskAadhaar("4321")).toBe("XXXX XXXX 4321");
    expect(maskAadhaar(null)).toBeNull();
  });

  it("is optional on the patient form and validated when given", () => {
    const base = { fullName: "Test Person", dob: "1990-01-01", gender: "female" };
    expect(patientInputSchema.safeParse(base).success).toBe(true);
    expect(patientInputSchema.safeParse({ ...base, aadhaar: "" }).success).toBe(true);
    expect(patientInputSchema.safeParse({ ...base, aadhaar: testAadhaar() }).success).toBe(true);
    const wrongCheck = testAadhaar().slice(0, 11) + ((Number(testAadhaar()[11]) + 1) % 10);
    expect(patientInputSchema.safeParse({ ...base, aadhaar: wrongCheck }).success).toBe(false);
    expect(patientInputSchema.safeParse({ ...base, aadhaar: "12345" }).success).toBe(false);
  });
});

describe("Date and time picker format", () => {
  it("shows DD/MM/YYYY hh:mm AM/PM (no seconds) and reads it back as 24-hour HH:mm", () => {
    expect(formatDateTime({ date: "2026-10-01", time: "10:20" })).toBe("01/10/2026   10:20 AM");
    expect(formatDateTime({ date: "2026-10-01", time: "22:05:00.000" })).toBe("01/10/2026   10:05 PM");
    expect(formatDateTime({ date: "2026-10-01", time: "00:15" })).toBe("01/10/2026   12:15 AM");
    expect(formatDateTime({ date: "2026-10-01", time: "12:00" })).toBe("01/10/2026   12:00 PM");
    expect(formatDateTime({})).toBe("");
    expect(parseDateTime("01/10/2026 10:20 AM")).toEqual({ date: "2026-10-01", time: "10:20" });
    expect(parseDateTime("01/10/2026     10:20 pm")).toEqual({ date: "2026-10-01", time: "22:20" });
    expect(parseDateTime("01/10/2026 12:00 AM")).toEqual({ date: "2026-10-01", time: "00:00" });
    expect(parseDateTime("01/10/2026 12:30 PM")).toEqual({ date: "2026-10-01", time: "12:30" });
    expect(parseDateTime("30/02/2026 10:20 AM")).toBeNull();
    expect(parseDateTime("01/10/2026 13:20 PM")).toBeNull();
    expect(parseDateTime("2026/10/01 10:20:00.000")).toBeNull();
    expect(toClock("17:45")).toEqual({ h: "05", m: "45", ap: "PM" });
    expect(fromClock({ h: "12", m: "00", ap: "AM" })).toBe("00:00");
    // Choosing another month / year keeps the day where it exists, else the month's last day.
    expect(clampDate("2026-01-31", 2026, 1)).toBe("2026-02-28");
    expect(clampDate("2026-01-31", 2028, 1)).toBe("2028-02-29");
    expect(clampDate("2026-01-15", 2027, 5)).toBe("2027-06-15");
  });

  it("the stay accepts times with seconds and milliseconds, and its end must follow its start", () => {
    const base = { claimType: "cashless", admissionDate: "2026-12-20", dischargeDate: "2026-12-20" };
    const issues = (v: object) => {
      const r = wizardClinicalSchema.safeParse({ ...base, ...v });
      return r.success ? [] : r.error.issues.map((i) => i.path[0]);
    };
    expect(issues({ admissionTime: "09:00:00.000", dischargeTime: "18:30:15.900" })).not.toContain("dischargeDate");
    expect(issues({ admissionTime: "09:00:00.000", dischargeTime: "08:00:00.000" })).toContain("dischargeDate");
    expect(issues({ admissionTime: "9:00" })).toContain("admissionTime");
  });

  it("chronic illness accepts list values and typed ones, but not None with others", () => {
    const issues = (v: string[]) => {
      const r = wizardClinicalSchema.safeParse({ claimType: "cashless", chronicIllness: v });
      return r.success ? [] : r.error.issues.filter((i) => i.path[0] === "chronicIllness").map((i) => i.message);
    };
    expect(issues(["Diabetes", "Thyroid disorder"])).toEqual([]);
    expect(issues(["None", "Diabetes"]).length).toBeGreaterThan(0);
    expect(issues(["x"]).length).toBeGreaterThan(0);
  });
});

describe("Supporting documents and the dashboard", () => {
  it("groups documents into the three categories", () => {
    expect(["id_proof", "insurance_card", "birth_certificate"].map(docCategory)).toEqual(["identity", "identity", "identity"]);
    expect(["preauth_form", "doctor_consultation", "medical_history", "investigation_reports"].map(docCategory)).toEqual(["medical", "medical", "medical", "medical"]);
    expect(docCategory("treatment_estimate")).toBe("financial");
  });

  it("risk level and step grouping come from the results", () => {
    expect(riskLevel({ refuse: 3, query: 1 })).toBe("High");
    expect(riskLevel({ refuse: 0, query: 2 })).toBe("Medium");
    expect(riskLevel({ refuse: 0, query: 0 })).toBe("Low");
    expect(checklistStep("patient_identified")).toBe(1);
    expect(checklistStep("diagnosis_confirmed")).toBe(2);
    expect(checklistStep("documents_uploaded")).toBe(3);
    expect(checklistStep("hospital_network")).toBe(4);
  });
});

describe("KYC Aadhaar and the registration form", () => {
  it("KYC accepts an optional Aadhaar as text and explains what is wrong", async () => {
    const { wizardKycSchema } = await import("@/modules/preauth/preauth.validation");
    const base = { patientName: "Asha Rao", gender: "female", dob: "1980-01-01", mobile: "9876500000", insurerId: "00000000-0000-4000-8000-0000000000b1", policyNumber: "P-1", policyFrom: "2026-04-01", policyTo: "2027-03-31" };
    const msg = (aadhaar: string) => {
      const r = wizardKycSchema.safeParse({ ...base, aadhaar });
      return r.success ? null : r.error.issues.find((i) => i.path[0] === "aadhaar")?.message ?? null;
    };
    expect(msg("")).toBeNull();
    expect(msg(testAadhaar())).toBeNull();
    expect(msg("12345")).toBe("Aadhaar Number has exactly 12 digits.");
    expect(msg("0123 4567 8901")).toBe("This isn't a valid Aadhaar number — check the digits.");
  });

  it("flags an Aadhaar at KYC that differs from the patient record", async () => {
    const { scrutinize, wizardDocuments } = await import("@/modules/preauth/preauth.scrutiny");
    const { computePreauthChecklist } = await import("@/modules/preauth/preauth.checklist");
    const checklist = computePreauthChecklist({ evaluation: null, hasPolicy: true, hasDiagnosis: true, hasProcedure: true, hasEstimate: true, manual: {} });
    const record = { fullName: "Asha Rao", gender: "female", dob: "1980-01-01", memberId: "M-1", coverStart: "2026-04-01", coverEnd: "2027-03-31", sumInsured: null, policyHasTpa: false };
    const kyc = { patientName: "Asha Rao", gender: "female", dob: "1980-01-01", mobile: "9", policyNumber: "P", policyFrom: "2026-04-01", policyTo: "2027-03-31", memberId: "M-1" };
    const keys = (a?: string, b?: string) =>
      scrutinize({ evaluated: false, clinicalIssues: [], documents: wizardDocuments(null, []), checklist, estimatedCost: null, availableBalance: null, today: "2026-10-09", kyc: { ...kyc, aadhaarHash: a }, record: { ...record, aadhaarHash: b } }).findings.map((f) => f.key);
    expect(keys("aaa", "bbb")).toContain("kyc:aadhaar");
    expect(keys("aaa", "aaa")).not.toContain("kyc:aadhaar");
    expect(keys(undefined, "bbb")).not.toContain("kyc:aadhaar");
  });

  it("builds the signed registration PDF", async () => {
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const pdf = await buildRegistrationPdf({
      title: "Case registration form", reference: "PA-1", hospital: "Test Hospital",
      sections: [{ title: "Patient", rows: [["Name", "Asha Rao"], ["Long", "word ".repeat(200)]] }],
      cost: [{ head: "Room rent", covers: "Twin sharing", perDay: "₹4,000", days: "3", amount: "₹12,000" }], costTotal: "₹12,000",
      signature: { png, signerName: "Vikram", signerRole: "Payer Reviewer", signedAt: "9 Oct 2026, 10:00" },
      generatedAt: "9 Oct 2026", generatedBy: "Vikram",
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});

describe("Patient KYC verification and the policy check", () => {
  const record = { patientNo: "PT-1", fullName: "Asha Rao", gender: "female", dob: "1980-01-01", aadhaarHash: "h1" };
  const entered = { uhid: "PT-1", patientName: "asha  rao", gender: "female", dob: "1980-01-01" };

  it("Verified when UHID, name and date of birth match; Failed on any difference; Pending when something isn't checkable", () => {
    expect(verifyAgainstRecord(entered, record).status).toBe("verified");
    expect(verifyAgainstRecord({ ...entered, aadhaarHash: "h1" }, record).status).toBe("verified");
    expect(verifyAgainstRecord({ ...entered, aadhaarHash: "other" }, record).status).toBe("failed");
    expect(verifyAgainstRecord({ ...entered, dob: "1981-01-01" }, record).status).toBe("failed");
    expect(verifyAgainstRecord({ ...entered, aadhaarHash: "h1" }, { ...record, aadhaarHash: null }).status).toBe("pending");
    expect(verifyAgainstRecord({ ...entered, uhid: undefined }, record).status).toBe("pending");
    const undisclosed = verifyAgainstRecord(entered, { ...record, gender: "undisclosed" });
    expect(undisclosed.status).toBe("verified");
    expect(undisclosed.items.find((i) => i.field === "gender")?.result).toBe("not_checked");
  });

  const facts = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({
    coverStatus: "in_force",
    coverStart: "2026-04-01",
    coverEnd: "2027-03-31",
    policyActive: true,
    policyHasTpa: false,
    sumInsured: 500000,
    recordedBalance: 400000,
    holds: [],
    estimate: null,
    eligibility: { overall: "PASS", results: [], missingInformation: [], requiredDocuments: [], preauthRequired: null, estimate: null },
    typed: { policyNumber: "P-1", memberId: "M-1" },
    ...over,
  });

  it("available balance is the recorded balance less open approvals", () => {
    expect(availableBalance({ recordedBalance: 400000, holds: [{ reference: "PA-1", amount: 150000 }] })).toBe(250000);
    expect(availableBalance({ recordedBalance: 100000, holds: [{ reference: "PA-1", amount: 150000 }] })).toBe(0);
    expect(availableBalance({ recordedBalance: null, holds: [] })).toBeNull();
  });

  it("warns on coverage, balance, rules and missing information; expired cover blocks", () => {
    expect(policyWarnings(facts())).toEqual([]);
    const keys = (f: PolicyFacts) => policyWarnings(f).map((w) => `${w.key}:${w.severity}`);
    expect(keys(facts({ coverStatus: "expired" }))).toContain("cover_period:blocker");
    expect(keys(facts({ policyActive: false }))).toContain("policy_inactive:warning");
    expect(keys(facts({ recordedBalance: 0 }))).toContain("balance_exhausted:warning");
    expect(keys(facts({ estimate: 450000 }))).toContain("balance_insufficient:warning");
    expect(keys(facts({ recordedBalance: null }))).toContain("balance_unknown:warning");
    expect(keys(facts({ policyHasTpa: true, typed: { policyNumber: "P", memberId: "" } }))).toContain("tpa_card_missing:warning");
    expect(keys(facts({ eligibility: null }))).toContain("rules_missing:warning");
    const ev = {
      overall: "FAIL" as const,
      results: [{ code: "AGE", title: "Age", category: "eligibility" as const, kind: "age_range", outcome: "FAIL" as const, message: "Too old.", missing: [], applicable: true }],
      missingInformation: [],
      requiredDocuments: [],
      preauthRequired: null,
      estimate: null,
    };
    expect(keys(facts({ eligibility: ev }))).toContain("eligibility:AGE:warning");
    // Every warning and blocker carries a corrective action.
    for (const over of [{ coverStatus: "expired" as const }, { policyActive: false }, { recordedBalance: 0 }, { eligibility: ev }, { eligibility: null }]) {
      for (const w of policyWarnings(facts(over))) expect(w.action.length).toBeGreaterThan(5);
    }
  });
});

describe("Policy Verification leaves case-dependent rules to Pre-Scrutiny", () => {
  it("raises rules missing member / policy facts, not those that only lack admission or diagnosis", () => {
    const res = (code: string, outcome: "FAIL" | "NEEDS_VERIFICATION", missing: string[]) => ({ code, title: code, category: "eligibility" as const, kind: "x", outcome, message: code, missing, applicable: true });
    const ev = { overall: "NEEDS_VERIFICATION" as const, missingInformation: [], requiredDocuments: [], preauthRequired: null, estimate: null, results: [
      res("WAIT", "NEEDS_VERIFICATION", ["Expected admission date"]),
      res("AGE", "NEEDS_VERIFICATION", ["Patient date of birth", "Expected admission date"]),
      res("NET", "FAIL", []),
    ] };
    const keys = policyWarnings({ coverStatus: "in_force", coverStart: "2026-04-01", coverEnd: "2027-03-31", policyActive: true, policyHasTpa: false, sumInsured: 1, recordedBalance: 1, holds: [], estimate: null, eligibility: ev, typed: { policyNumber: "P" } }).map((w) => w.key);
    expect(keys).toEqual(["eligibility:AGE", "eligibility:NET"]);
  });
});
