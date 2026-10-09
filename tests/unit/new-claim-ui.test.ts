import { describe, expect, it } from "vitest";
import { isValidAadhaar, maskAadhaar } from "@/lib/india";
import { formatDateTime, parseDateTime } from "@/components/ui/DateTimePicker";
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
  it("shows YYYY/MM/DD HH:mm:ss.SSS and reads it back", () => {
    expect(formatDateTime({ date: "2026-05-14", time: "09:30:00.500" })).toBe("2026/05/14 09:30:00.500");
    expect(formatDateTime({ date: "2026-05-14", time: "09:30" })).toBe("2026/05/14 09:30:00.000");
    expect(formatDateTime({})).toBe("");
    expect(parseDateTime("2026/05/14 09:30:00.500")).toEqual({ date: "2026-05-14", time: "09:30:00.500" });
    expect(parseDateTime("2026/02/30 09:30:00.000")).toBeNull();
    expect(parseDateTime("2026/05/14 24:00:00.000")).toBeNull();
    expect(parseDateTime("14/05/2026")).toBeNull();
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
